import type { Builder, Planner, Reviewer, VerifyResult } from "./agents/types.js";
import type { GitOps } from "./git.js";
import type { RunReporter } from "./reporter.js";
import type { RunStore } from "./run-store.js";

export interface PipelineConfig {
  maxVerifyRetries: number;
  planModel: string;
  buildModel: string;
  codexModel: string;
  reviewPolicy: "all" | "any"; // commit when every / any reviewer passes
}

export interface PipelineDeps {
  planner: Planner;
  builder: Builder;
  reviewers: Reviewer[]; // fan-out: every reviewer inspects the same diff
  git: GitOps;
  store: RunStore;
  config: PipelineConfig;
}

// The plan → approve → build/verify/commit state machine. It owns ONLY the
// orchestration policy; every side effect (LLM calls, git, persistence,
// reporting, approval) is reached through an injected abstraction (DIP), and
// each phase is its own method (SRP) so they can be read and changed in
// isolation.
//
// Alongside run-level status it emits a Step (an agent work span) for each
// phase — plan, each build attempt, and each verify — so the dashboard can
// render the process as a timeline / node graph / kanban off one data source.
export class RunPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  // ①★ PLAN → park at approval. Opus proposes a plan; we persist the plan text +
  // its decomposed steps and set the run to awaiting_approval, then RETURN — we
  // do NOT hold the approval in memory. The approval is resolved out-of-band
  // (runner.resolveApproval) by reading the DB, so a pending approval survives an
  // orchestrator restart. Used for the initial plan and for a revise (feedback →
  // re-plan).
  async plan(
    runId: string,
    brief: string,
    targetDir: string,
    reporter: RunReporter,
    opts: { previousPlan?: string; feedback?: string } = {}
  ): Promise<void> {
    await this.deps.git.ensureRepo(targetDir);
    const order = await this.resumeOrder(runId);
    const planned = await this.planOnce(
      brief,
      targetDir,
      reporter,
      order,
      opts.previousPlan,
      opts.feedback
    );
    if (planned === null) return; // planOnce already marked the run failed

    await this.deps.store.saveSteps(runId, planned.steps);
    await reporter.status("awaiting_approval", { plan: planned.text });
    await reporter.log(
      "approval",
      opts.feedback
        ? "피드백을 반영해 계획을 수정했습니다 — 다시 승인/수정 대기 중입니다."
        : "계획 완성 — 대시보드에서 승인/수정 대기 중입니다."
    );
  }

  // ②③④ BUILD — resume after approval. Loads the approved plan + steps from the
  // DB (so it works even if this process didn't produce the plan, e.g. after a
  // restart), then walks the steps. Called by runner.resolveApproval on approve.
  async build(runId: string, reporter: RunReporter): Promise<void> {
    const st = await this.deps.store.getResumeState(runId);
    if (!st || !st.targetDir || !st.plan) {
      await reporter.status("failed", { error: "재개할 계획 정보가 없습니다." });
      return;
    }
    await this.deps.git.ensureRepo(st.targetDir);
    const order = await this.resumeOrder(runId);
    const planStepId = (await this.deps.store.getPlanStepId(runId)) ?? "";
    // Fall back to the whole plan as a single step for runs planned before steps
    // were persisted.
    const steps = st.steps.length > 0 ? st.steps : [st.plan];
    await this.executeSteps(
      runId,
      st.plan,
      steps,
      st.brief,
      st.targetDir,
      reporter,
      order,
      planStepId
    );
  }

  // Monotonic orderIdx generator that continues past any steps already stored for
  // this run, so a resumed phase sorts after the earlier ones.
  private async resumeOrder(runId: string): Promise<() => number> {
    let n = (await this.deps.store.getMaxOrderIdx(runId)) + 1;
    return () => n++;
  }

  // ① PLAN (Opus) — returns the plan text, its step id, and the decomposed step
  // list, or null on failure. The machine-readable ```steps block is stripped
  // from the text shown for approval. When feedback is given, revises the prior
  // plan instead of starting fresh.
  private async planOnce(
    brief: string,
    targetDir: string,
    reporter: RunReporter,
    order: () => number,
    previousPlan?: string,
    feedback?: string
  ): Promise<{ text: string; stepId: string; steps: string[] } | null> {
    const { planner, config } = this.deps;
    const revising = !!feedback;
    await reporter.status("planning");
    const step = await reporter.startStep({
      kind: "plan",
      label: revising ? "계획 수정" : "계획",
      engine: "claude",
      model: config.planModel,
      orderIdx: order(),
    });
    await step.log(
      "plan",
      revising
        ? `피드백을 반영해 계획 수정 중 (${config.planModel})…`
        : `계획 수립 중 (${config.planModel})…`,
      { model: "opus" }
    );

    const result = await planner.plan({ brief, cwd: targetDir, previousPlan, feedback }, step);
    if (result.isError || !result.text) {
      await step.finish("failed", "계획을 생성하지 못했습니다.");
      await reporter.status("failed", { error: "계획을 생성하지 못했습니다." });
      return null;
    }
    const { steps, cleanText } = parseSteps(result.text);
    await step.log("plan", `계획을 ${steps.length}개 작업 단계로 분해했습니다.`, { model: "opus" });
    await step.finish("passed", compactAgentSummary(cleanText, "승인용 구현 계획을 작성했습니다."));
    return { text: cleanText, stepId: step.id, steps };
  }

  // ②③④ Walk the plan step by step. Each step is implemented (Sonnet), verified
  // (codex) and committed on its own; only when a step's commit lands do we move
  // to the next. A step that never passes fails the whole run.
  private async executeSteps(
    runId: string,
    approvedPlan: string,
    steps: string[],
    brief: string,
    targetDir: string,
    reporter: RunReporter,
    order: () => number,
    planStepId: string
  ): Promise<void> {
    const { config } = this.deps;
    // Chain parent: step 1 hangs off the plan; each next step hangs off the
    // previous step's commit, so the node graph is one connected spine.
    let parentId = planStepId;
    let lastSha = "";
    const completed: string[] = [];

    for (let i = 0; i < steps.length; i++) {
      const outcome = await this.runStep({
        runId,
        approvedPlan,
        brief,
        targetDir,
        reporter,
        order,
        parentId,
        description: steps[i],
        index: i + 1,
        total: steps.length,
        completed: [...completed],
      });

      if (!outcome.passed) {
        await reporter.status("rejected", {
          error: `단계 ${i + 1}/${steps.length}이(가) ${config.maxVerifyRetries}번의 시도 안에 검증을 통과하지 못했습니다. 마지막 사유: ${outcome.feedback ?? "-"}`,
        });
        return;
      }
      parentId = outcome.lastStepId;
      lastSha = outcome.sha;
      completed.push(steps[i]);
    }

    await reporter.status("committed", { commit: lastSha });
    await reporter.log(
      "commit",
      `모든 단계(${steps.length}개) 완료 ✅ 최종 커밋 ${lastSha.slice(0, 10)}`
    );
  }

  // One plan step: BUILD (Sonnet, this step only) → VERIFY (codex over this
  // step's uncommitted diff) → COMMIT, retrying the build on rejection with the
  // reviewer's reason fed back. Returns the commit sha + tail step id on pass.
  private async runStep(ctx: {
    runId: string;
    approvedPlan: string;
    brief: string;
    targetDir: string;
    reporter: RunReporter;
    order: () => number;
    parentId: string;
    description: string;
    index: number;
    total: number;
    completed: string[];
  }): Promise<{ passed: boolean; lastStepId: string; sha: string; feedback?: string }> {
    const { builder, reviewers, git, store, config } = this.deps;
    const { reporter, targetDir, order } = ctx;
    const tag = `단계 ${ctx.index}/${ctx.total}`;
    let feedback: string | undefined;
    let parentId = ctx.parentId;

    for (let attempt = 1; attempt <= config.maxVerifyRetries; attempt++) {
      // ② BUILD (auto-approved, scoped to this step)
      await reporter.status("building");
      const buildStep = await reporter.startStep({
        kind: "build",
        label: `${tag} · 빌드${attempt > 1 ? ` (시도 ${attempt})` : ""}`,
        engine: "claude",
        model: config.buildModel,
        attempt,
        parentId,
        orderIdx: order(),
      });
      await buildStep.log("build", `${tag} 구현 중 (${config.buildModel})…`, { model: "sonnet" });

      const buildResult = await builder.build(
        {
          approvedPlan: ctx.approvedPlan,
          brief: ctx.brief,
          cwd: targetDir,
          feedback,
          step: {
            index: ctx.index,
            total: ctx.total,
            description: ctx.description,
            completed: ctx.completed,
          },
        },
        buildStep
      );
      if (buildResult.isError) {
        await buildStep.log("build", "빌드 에이전트에서 오류가 발생했습니다.", { level: "warn" });
      }

      if (!(await git.hasChanges(targetDir))) {
        await buildStep.log("build", "변경된 파일이 없습니다.", { level: "warn" });
        await buildStep.finish("failed", "변경 없음");
        feedback = "이전 시도에서 아무 변경도 만들지 않았습니다. 이 단계를 실제로 구현하세요.";
        parentId = buildStep.id;
        continue;
      }
      await buildStep.finish(
        "passed",
        compactAgentSummary(buildResult.text, `${tag}를 구현했습니다.`)
      );

      // ③ VERIFY — codex reviews THIS step's uncommitted diff (previous steps
      // are already committed, so the diff is exactly this step's changes).
      await reporter.status("verifying");
      const diff = await git.uncommittedDiff(targetDir);
      const stepPlan = `${ctx.approvedPlan}\n\n=== 지금 검증할 단계 (${ctx.index}/${ctx.total}) ===\n${ctx.description}`;
      const reviews = await this.review(reporter, reviewers, {
        approvedPlan: stepPlan,
        diff,
        cwd: targetDir,
        attempt,
        buildStepId: buildStep.id,
        order,
      });

      const passed =
        reviews.length > 0 &&
        (config.reviewPolicy === "any"
          ? reviews.some((r) => r.result.passed)
          : reviews.every((r) => r.result.passed));
      const lastReviewStepId = reviews[reviews.length - 1]?.stepId ?? buildStep.id;

      // ④ COMMIT this step (on PASS) and move on.
      if (passed) {
        const commitStep = await reporter.startStep({
          kind: "commit",
          label: `${tag} · 커밋`,
          parentId: lastReviewStepId,
          attempt,
          orderIdx: order(),
        });
        const title = (await store.getTitle(ctx.runId)) ?? "agent-loop change";
        const reviewerNames = reviews.map((r) => r.reviewer.name).join(", ");
        const message = `${title} — ${tag}\n\n${ctx.description}\n\nVerified by ${reviewerNames} (attempt ${attempt}).`;
        const sha = await git.commitAll(targetDir, message);
        await commitStep.finish("passed", `${tag} 검증 통과 후 ${sha.slice(0, 10)} 커밋.`);
        await reporter.log(
          "commit",
          `${tag} 커밋 ${sha.slice(0, 10)} ✅ (${reviewerNames} 통과, ${attempt}번째 시도)`
        );
        return { passed: true, lastStepId: commitStep.id, sha };
      }

      // Feed every failing reviewer's reason back into the next attempt.
      feedback = reviews
        .filter((r) => !r.result.passed)
        .map((r) => `[${r.reviewer.name}] ${r.result.reason}`)
        .join("\n\n");
      parentId = lastReviewStepId;
    }

    await reporter.log(
      "verify",
      `${tag}: ${config.maxVerifyRetries}번 시도했지만 검증을 통과하지 못했습니다.`,
      { level: "error" }
    );
    return { passed: false, lastStepId: parentId, sha: "", feedback };
  }

  // Run every reviewer over the same diff in parallel, each as its own step.
  private async review(
    reporter: RunReporter,
    reviewers: Reviewer[],
    ctx: {
      approvedPlan: string;
      diff: string;
      cwd: string;
      attempt: number;
      buildStepId: string;
      order: () => number;
    }
  ): Promise<Array<{ reviewer: Reviewer; result: VerifyResult; stepId: string }>> {
    return Promise.all(
      reviewers.map(async (reviewer) => {
        const label = reviewer.kind === "test" ? `테스트: ${reviewer.name}` : `리뷰: ${reviewer.name}`;
        const step = await reporter.startStep({
          kind: reviewer.kind,
          label,
          engine: reviewer.engine,
          model: reviewer.model,
          attempt: ctx.attempt,
          parentId: ctx.buildStepId,
          orderIdx: ctx.order(),
        });
        await step.log("verify", `${reviewer.name} 검토 중…`, { model: reviewer.engine });
        const result = await reviewer.review({
          cwd: ctx.cwd,
          plan: ctx.approvedPlan,
          diff: ctx.diff,
        });
        await step.verdict(ctx.attempt, result.passed, result.reason, ctx.diff, result.raw);
        if (result.usage && reviewer.model !== "-") {
          await step.usage({
            engine: reviewer.engine === "codex" ? "codex" : "claude",
            model: reviewer.model,
            phase: "verify",
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cacheRead: result.usage.cacheRead,
            cacheWrite: 0,
          });
        }
        await step.log(
          "verify",
          `${reviewer.name} ${result.passed ? "통과 ✅" : "거절 ❌"}: ${result.reason}`,
          { level: result.passed ? "info" : "warn", model: reviewer.engine }
        );
        await step.finish(result.passed ? "passed" : "failed", result.reason);
        return { reviewer, result, stepId: step.id };
      })
    );
  }
}

// Pull the machine-readable step list out of the planner's output — a fenced
// ```steps block holding a JSON array of step descriptions — and return the
// plan text with that block removed (so the approval view stays clean). Falls
// back to a single step (the whole plan) when no valid block is present, which
// degrades gracefully to a one-shot build.
function parseSteps(planText: string): { steps: string[]; cleanText: string } {
  const fence = /```steps\s*([\s\S]*?)```/i;
  const m = planText.match(fence);
  if (m) {
    try {
      const arr = JSON.parse(m[1].trim());
      if (Array.isArray(arr)) {
        const steps = arr.map((s) => String(s).trim()).filter(Boolean);
        if (steps.length > 0) {
          return { steps, cleanText: planText.replace(fence, "").trim() };
        }
      }
    } catch {
      /* malformed block — fall back to a single step */
    }
  }
  return { steps: [planText.trim()], cleanText: planText };
}

// Store the agent's full summary (markdown structure preserved), not a clipped
// one-liner — the dashboard truncates for its collapsed preview and renders the
// full thing as markdown on expand, so "더보기" must have everything to show.
// Only collapse runs of blank lines and trim.
function compactAgentSummary(text: string | undefined, fallback: string): string {
  const cleaned = (text ?? "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || fallback;
}
