import { REVIEWER_AGENT_ID, rosterOf, type RunRoster } from "@agent-loop/shared/roster";
import type { InterventionDecision } from "@agent-loop/shared/types";
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

  // The injected reviewer fan-out, narrowed to the run's selected 검증자들.
  // (Reviewer.name is the identity key: 품질/보안/통합/빌드/tests.)
  private reviewersFor(roster: RunRoster): Reviewer[] {
    return this.deps.reviewers.filter((r) => roster.reviewerNames.includes(r.name));
  }

  // Which selected builder takes this (global) attempt — retries hand off
  // between the selected developers, matching the dashboard's seating rule.
  private builderFor(roster: RunRoster, attempt: number): string | undefined {
    const ids = roster.builderIds;
    if (ids.length === 0) return undefined;
    return ids[(Math.max(1, attempt) - 1) % ids.length];
  }

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
  // restart), then walks the remaining steps. Resume-aware: starts at the first
  // not-yet-committed step, so a mid-way orchestrator restart continues instead
  // of redoing committed work. Called by runner.resolveApproval on approve.
  async build(runId: string, reporter: RunReporter): Promise<void> {
    const st = await this.loadBuildState(runId, reporter);
    if (!st) return;
    const { committedCount, lastCommitStepId } = await this.deps.store.getResumePoint(runId);
    const startIdx = Math.min(committedCount, st.steps.length);
    await this.executeSteps({
      runId,
      approvedPlan: st.plan,
      steps: st.steps,
      brief: st.brief,
      targetDir: st.targetDir,
      reporter,
      order: st.order,
      roster: st.roster,
      seedParentId: lastCommitStepId ?? st.planStepId,
      startIdx,
    });
  }

  // 기획 생략 모드 (호재 미참여): the brief itself becomes the "approved plan"
  // as a single step — no approval gate — and the build/verify loop starts
  // immediately. Persisted like an approved plan so restart/retry resume works.
  async directBuild(runId: string, brief: string, targetDir: string, reporter: RunReporter): Promise<void> {
    await this.deps.git.ensureRepo(targetDir);
    await this.deps.store.savePlan(runId, brief);
    await this.deps.store.saveSteps(runId, [brief]);
    await reporter.log("approval", "기획 에이전트 없이 시작 — 요구사항을 그대로 구현합니다 (승인 단계 생략).");
    await reporter.status("building");
    await this.build(runId, reporter);
  }

  // 기획 전용 모드 (호재만 참여): produce the plan document and finish — there
  // is no builder to hand it to, so the run completes at the plan.
  async planOnly(runId: string, brief: string, targetDir: string, reporter: RunReporter): Promise<void> {
    await this.deps.git.ensureRepo(targetDir);
    const order = await this.resumeOrder(runId);
    const planned = await this.planOnce(brief, targetDir, reporter, order);
    if (planned === null) return; // planOnce already marked the run failed
    await this.deps.store.saveSteps(runId, planned.steps);
    await reporter.status("committed", { plan: planned.text });
    await reporter.log("plan", "기획 전용 작업 — 계획서 작성을 완료했습니다 ✅ (구현 없이 종료)");
  }

  // 검증 전용 모드 (검증자만 참여): audit the project's CURRENT state instead of
  // reviewing a fresh diff. Each selected reviewer inspects the working copy
  // through its own lens; all pass → 완료, any fail → failed with the reasons.
  async verifyOnly(
    runId: string,
    brief: string,
    targetDir: string,
    reporter: RunReporter,
    roster: RunRoster
  ): Promise<void> {
    const { git } = this.deps;
    await git.ensureRepo(targetDir);
    const reviewers = this.reviewersFor(roster);
    if (reviewers.length === 0) {
      await reporter.status("failed", { error: "선택된 검증 에이전트가 없습니다." });
      return;
    }
    const order = await this.resumeOrder(runId);
    const names = reviewers.map((r) => r.name).join(", ");
    await reporter.status("verifying");
    await reporter.log("verify", `검증 전용 작업 — ${names} 검증자가 프로젝트 현재 상태를 감사합니다.`);

    const diff = await git.uncommittedDiff(targetDir);
    const auditPlan = [
      "## 검증 전용 작업 (감사 모드)",
      "이 작업은 새 코드 변경에 대한 리뷰가 아니라, 프로젝트의 **현재 상태 전체**에 대한 감사입니다.",
      "DIFF가 비어 있어도 정상입니다 — 작업 디렉터리의 실제 코드를 직접 읽고, 아래 요청 관점에서",
      "당신의 렌즈로 감사하세요. 실질적(material) 문제가 없으면 PASS, 있으면 FAIL과 함께",
      "구체적 위치와 사유를 남기세요.",
      "",
      "## 사용자의 검증 요청",
      brief,
    ].join("\n");

    const reviews = await this.review(reporter, reviewers, {
      approvedPlan: auditPlan,
      diff: diff || "(변경 없음 — 저장소 전체를 직접 감사하세요)",
      cwd: targetDir,
      attempt: 1,
      previousFailures: [],
      parentId: null,
      order,
    });
    for (const r of reviews) {
      await reporter.chat({
        role: "verify",
        attempt: 1,
        kind: "verify",
        toRole: "user",
        stepLabel: "프로젝트 감사",
        passed: r.result.passed,
        engine: r.reviewer.name,
        agent: REVIEWER_AGENT_ID[r.reviewer.name],
        text: r.result.reason,
      });
    }

    // 감사 모드는 reviewPolicy("any")를 따르지 않는다: 이 run의 목적 자체가
    // "문제 발견 보고"이므로, 검증자 한 명이라도 FAIL이면 그 사유를 그대로
    // 노출해야 한다 (보안 FAIL이 품질 PASS에 가려지면 안 됨).
    const failed = reviews.filter((r) => !r.result.passed);
    if (reviews.length > 0 && failed.length === 0) {
      await reporter.status("committed", {});
      await reporter.log("verify", `프로젝트 감사 완료 ✅ — ${names} 모두 통과했습니다.`);
    } else {
      const passedNames = reviews.filter((r) => r.result.passed).map((r) => r.reviewer.name);
      const reasons = failed.map((r) => `[${r.reviewer.name}] ${r.result.reason}`).join("\n\n");
      await reporter.status("failed", {
        error: `검증에서 문제가 발견되었습니다 (${failed.map((r) => r.reviewer.name).join(", ")} 실패${passedNames.length ? ` · ${passedNames.join(", ")} 통과` : ""}):\n${reasons}`,
      });
      await reporter.log(
        "verify",
        `프로젝트 감사 결과 문제 발견 ❌ — 실패 ${failed.map((r) => r.reviewer.name).join(", ")}${passedNames.length ? ` / 통과 ${passedNames.join(", ")}` : ""}`,
        { level: "warn" }
      );
    }
  }

  // Resume a run parked at needs_input, per the user's decision on the stuck step:
  //  - guide: re-run the stuck step with the user's guidance seeded as feedback
  //  - commit: accept the current (rejected) diff as-is and move to the next step
  //  - skip:   throw away the stuck step's changes and move on
  //  - abort:  reject the run
  async resumeFromInput(
    runId: string,
    reporter: RunReporter,
    decision: InterventionDecision
  ): Promise<void> {
    if (decision.action === "abort") {
      await reporter.log("approval", "사용자가 막힌 단계에서 작업을 중단했습니다.", { level: "warn" });
      await reporter.status("rejected", { error: "사용자가 막힌 단계에서 작업을 중단했습니다." });
      return;
    }

    const st = await this.loadBuildState(runId, reporter);
    if (!st) return;
    const { git, store } = this.deps;
    const { committedCount, lastCommitStepId } = await store.getResumePoint(runId);
    const stuckIdx = Math.min(committedCount, st.steps.length - 1);
    const stuckTag = `단계 ${stuckIdx + 1}/${st.steps.length}`;
    const parent = lastCommitStepId ?? st.planStepId;

    const continueFrom = (fromIdx: number, seedParentId: string, seedFeedback?: string) =>
      this.executeSteps({
        runId,
        approvedPlan: st.plan,
        steps: st.steps,
        brief: st.brief,
        targetDir: st.targetDir,
        reporter,
        order: st.order,
        roster: st.roster,
        seedParentId,
        startIdx: fromIdx,
        seedFeedbackForFirst: seedFeedback,
      });

    if (decision.action === "guide") {
      await reporter.log("approval", `사용자 지침: ${decision.feedback}`);
      await reporter.chat({
        role: "user",
        attempt: 1,
        kind: "guide",
        toRole: "build",
        stepLabel: stuckTag,
        text: decision.feedback,
      });
      await reporter.status("building");
      const seed = `# 사용자(팀 리더)의 지침 — 반드시 따르세요\n${decision.feedback}`;
      await continueFrom(stuckIdx, parent, seed);
      return;
    }

    // commit / skip: record a resolving commit-step for the stuck step so the
    // resume point advances, then continue with the next step.
    await reporter.status("building");
    let resolveStepId = parent;
    if (decision.action === "commit" && (await git.hasChanges(st.targetDir))) {
      const title = (await store.getTitle(runId)) ?? "agent-loop change";
      const sha = await git.commitAll(
        st.targetDir,
        `${title} — ${stuckTag} (사용자 승인 커밋)\n\n${st.steps[stuckIdx]}`
      );
      const step = await reporter.startStep({
        kind: "commit",
        label: `${stuckTag} · 커밋(사용자 승인)`,
        parentId: parent,
        attempt: 1,
        orderIdx: st.order(),
      });
      await step.finish("passed", `사용자 승인으로 ${sha.slice(0, 10)} 커밋.`);
      await reporter.log("commit", `${stuckTag} 사용자 승인 커밋 ${sha.slice(0, 10)} ✅`);
      resolveStepId = step.id;
    } else {
      if (decision.action === "skip") await git.discardChanges(st.targetDir);
      const step = await reporter.startStep({
        kind: "commit",
        label: `${stuckTag} · ${decision.action === "skip" ? "건너뜀" : "커밋(변경 없음)"}`,
        parentId: parent,
        attempt: 1,
        orderIdx: st.order(),
      });
      await step.finish("skipped", decision.action === "skip" ? "사용자가 이 단계를 건너뛰었습니다." : "커밋할 변경이 없어 다음 단계로 진행합니다.");
      await reporter.log("commit", `${stuckTag} ${decision.action === "skip" ? "건너뜀" : "변경 없음 → 다음 단계"} (사용자 요청).`, { level: "warn" });
      resolveStepId = step.id;
    }
    await continueFrom(stuckIdx + 1, resolveStepId);
  }

  // Shared prologue for build/resume: load the approved plan + steps and ensure
  // the repo, or mark the run failed and return null.
  private async loadBuildState(
    runId: string,
    reporter: RunReporter
  ): Promise<
    | {
        plan: string;
        steps: string[];
        brief: string;
        targetDir: string;
        planStepId: string;
        order: () => number;
        roster: RunRoster;
      }
    | null
  > {
    const st = await this.deps.store.getResumeState(runId);
    if (!st || !st.targetDir || !st.plan) {
      await reporter.status("failed", { error: "재개할 계획 정보가 없습니다." });
      return null;
    }
    await this.deps.git.ensureRepo(st.targetDir);
    const order = await this.resumeOrder(runId);
    const planStepId = (await this.deps.store.getPlanStepId(runId)) ?? "";
    // Fall back to the whole plan as a single step for runs planned before steps
    // were persisted.
    const steps = st.steps.length > 0 ? st.steps : [st.plan];
    return {
      plan: st.plan,
      steps,
      brief: st.brief,
      targetDir: st.targetDir,
      planStepId,
      order,
      roster: rosterOf(st.agents),
    };
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
      agent: "hojae",
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

  // ②③④ Walk the plan step by step from `startIdx`. Each step is implemented
  // (Sonnet), verified (codex) and committed on its own; a step that keeps
  // failing escalates to 호재 (Opus) and, if still stuck, parks the run at
  // needs_input for the user instead of killing the whole run.
  private async executeSteps(args: {
    runId: string;
    approvedPlan: string;
    steps: string[];
    brief: string;
    targetDir: string;
    reporter: RunReporter;
    order: () => number;
    roster: RunRoster;
    seedParentId: string;
    startIdx: number;
    seedFeedbackForFirst?: string;
  }): Promise<void> {
    const { runId, approvedPlan, steps, brief, targetDir, reporter, order, roster } = args;
    const { git } = this.deps;
    // Chain parent: the first (resumed) step hangs off seedParentId (plan step,
    // or the previous step's commit); each next step hangs off the previous
    // step's commit, so the node graph is one connected spine.
    let parentId = args.seedParentId;
    let lastSha = "";
    const completed = steps.slice(0, args.startIdx);

    for (let i = args.startIdx; i < steps.length; i++) {
      const outcome = await this.runStep({
        runId,
        approvedPlan,
        brief,
        targetDir,
        reporter,
        order,
        roster,
        parentId,
        description: steps[i],
        index: i + 1,
        total: steps.length,
        completed: [...completed],
        seedFeedback: i === args.startIdx ? args.seedFeedbackForFirst : undefined,
      });

      if (!outcome.passed) {
        await reporter.status("needs_input", {
          error: `단계 ${i + 1}/${steps.length}이(가) 재시도${roster.planner ? "와 호재(Opus) 개입" : ""} 후에도 검증을 통과하지 못했습니다. 마지막 사유: ${outcome.feedback ?? "-"}`,
        });
        return;
      }
      parentId = outcome.lastStepId;
      if (outcome.sha) lastSha = outcome.sha;
      completed.push(steps[i]);
    }

    const finalSha = lastSha || (await git.headSha(targetDir));
    await reporter.status("committed", { commit: finalSha });
    await reporter.log(
      "commit",
      `모든 단계(${steps.length}개) 완료 ✅ 최종 커밋 ${finalSha.slice(0, 10)}`
    );
  }

  // One plan step with the escalation ladder: round 1 (builders retry up to
  // maxVerifyRetries) → 호재(Opus) intervention → round 2 (builders retry again,
  // armed with the lead's guidance). Still failing → not passed (→ needs_input).
  private async runStep(ctx: {
    runId: string;
    approvedPlan: string;
    brief: string;
    targetDir: string;
    reporter: RunReporter;
    order: () => number;
    roster: RunRoster;
    parentId: string;
    description: string;
    index: number;
    total: number;
    completed: string[];
    seedFeedback?: string;
  }): Promise<{ passed: boolean; lastStepId: string; sha: string; feedback?: string }> {
    const { config } = this.deps;
    const { reporter } = ctx;
    const tag = `단계 ${ctx.index}/${ctx.total}`;

    // Round 1 — builders try on their own (seeded with the user's guidance if
    // this is a post-intervention resume).
    const r1 = await this.runStepRound(ctx, { seedFeedback: ctx.seedFeedback, attemptOffset: 0 });
    if (r1.passed) return r1;

    // 호재가 팀에 없으면 에스컬레이션 라운드가 없다 — 바로 사용자 개입으로.
    if (!ctx.roster.planner) {
      await reporter.log(
        "verify",
        `${tag}: 검증을 통과하지 못했습니다 — 기획 에이전트(호재)가 없어 바로 사용자 개입을 기다립니다.`,
        { level: "error" }
      );
      return { passed: false, lastStepId: r1.lastStepId, sha: "", feedback: r1.feedback };
    }

    // Escalate to 호재 (Opus): diagnose the repeated failures + hand the builder
    // concrete guidance for the next round.
    const escal = await this.escalate(ctx, r1);

    // Round 2 — same builders, now following the lead's fix plan. Reviewers get
    // round 1's rejections as history so they converge instead of re-litigating.
    const r2 = await this.runStepRound(
      { ...ctx, parentId: escal.stepId },
      {
        seedFeedback: escal.guidance,
        attemptOffset: config.maxVerifyRetries,
        previousFailures: r1.failures,
      }
    );
    if (r2.passed) return r2;

    await reporter.log(
      "verify",
      `${tag}: 호재 개입 후에도 검증을 통과하지 못했습니다 — 사용자 개입을 기다립니다.`,
      { level: "error" }
    );
    return { passed: false, lastStepId: r2.lastStepId, sha: "", feedback: r2.feedback };
  }

  // 호재(Opus) steps in when a step keeps failing: reads the diff + failures and
  // returns actionable guidance. Emits a 호재 (plan-kind) step so it shows inline
  // in the step's flow. Read-only — never touches files.
  private async escalate(
    ctx: {
      approvedPlan: string;
      targetDir: string;
      reporter: RunReporter;
      order: () => number;
      description: string;
      index: number;
      total: number;
    },
    round1: { lastStepId: string; failures: string[] }
  ): Promise<{ guidance: string; stepId: string }> {
    const { planner, git, config } = this.deps;
    const { reporter, targetDir } = ctx;
    const tag = `단계 ${ctx.index}/${ctx.total}`;
    const step = await reporter.startStep({
      kind: "plan",
      label: `${tag} · 호재 개입`,
      engine: "claude",
      model: config.planModel,
      agent: "hojae",
      attempt: config.maxVerifyRetries,
      parentId: round1.lastStepId,
      orderIdx: ctx.order(),
    });
    await step.log(
      "plan",
      `${tag}가 ${config.maxVerifyRetries}번 실패 — 호재(Opus)가 원인을 분석해 해결책을 제시합니다…`,
      { model: "opus" }
    );
    const diff = await git.uncommittedDiff(targetDir);
    const res = await planner.intervene(
      {
        cwd: targetDir,
        approvedPlan: ctx.approvedPlan,
        stepDescription: ctx.description,
        index: ctx.index,
        total: ctx.total,
        attempts: config.maxVerifyRetries,
        failures: round1.failures,
        diff,
      },
      step
    );
    const guidance =
      res.text?.trim() ||
      "이전 실패 원인을 근본적으로 다시 점검하고, 검증자의 지적을 정확히 해결하세요.";
    await step.finish(res.isError ? "failed" : "passed", compactAgentSummary(guidance, "해결책을 제시했습니다."));
    // 💬 호재 drops into the chat with the fix plan for the builders.
    await reporter.chat({
      role: "plan",
      attempt: this.deps.config.maxVerifyRetries,
      kind: "escalate",
      toRole: "build",
      stepLabel: `단계 ${ctx.index}/${ctx.total}`,
      agent: "hojae",
      text: guidance,
    });
    return { guidance, stepId: step.id };
  }

  // One round of BUILD (Sonnet, this step only) → VERIFY (codex) → COMMIT,
  // retrying up to maxVerifyRetries with the reviewer's reason fed back. Returns
  // the commit sha + tail step id on pass, or the accumulated failure reasons.
  private async runStepRound(
    ctx: {
      runId: string;
      approvedPlan: string;
      brief: string;
      targetDir: string;
      reporter: RunReporter;
      order: () => number;
      roster: RunRoster;
      parentId: string;
      description: string;
      index: number;
      total: number;
      completed: string[];
    },
    opts: { seedFeedback?: string; attemptOffset: number; previousFailures?: string[] }
  ): Promise<{ passed: boolean; lastStepId: string; sha: string; feedback?: string; failures: string[] }> {
    const { builder, git, store, config } = this.deps;
    const reviewers = this.reviewersFor(ctx.roster);
    const { reporter, targetDir, order } = ctx;
    const tag = `단계 ${ctx.index}/${ctx.total}`;
    let feedback: string | undefined = opts.seedFeedback;
    let parentId = ctx.parentId;
    // Seeded with the prior round's rejections (if any) so reviewers see the
    // whole rejection history for this step, not just this round's.
    const failures: string[] = [...(opts.previousFailures ?? [])];

    for (let n = 1; n <= config.maxVerifyRetries; n++) {
      const attempt = opts.attemptOffset + n; // global attempt no. (round 2 → 6..10)
      const builderId = this.builderFor(ctx.roster, attempt);
      // ② BUILD (auto-approved, scoped to this step)
      await reporter.status("building");
      const buildStep = await reporter.startStep({
        kind: "build",
        label: `${tag} · 빌드${attempt > 1 ? ` (시도 ${attempt})` : ""}`,
        engine: "claude",
        model: config.buildModel,
        agent: builderId,
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
      const buildSummary = compactAgentSummary(buildResult.text, `${tag}를 구현했습니다.`);
      await buildStep.finish("passed", buildSummary);
      // 💬 builder tells the verifiers what it did (team chat).
      await reporter.chat({
        role: "build",
        attempt,
        kind: "build",
        toRole: "verify",
        stepLabel: tag,
        agent: builderId,
        text: buildSummary,
      });

      // ③ VERIFY — codex reviews THIS step's uncommitted diff (previous steps
      // are already committed, so the diff is exactly this step's changes).
      // 검증 에이전트가 선택되지 않은 팀은 리뷰를 생략하고 바로 커밋한다.
      let reviews: Array<{ reviewer: Reviewer; result: VerifyResult; stepId: string }> = [];
      if (reviewers.length > 0) {
        await reporter.status("verifying");
        const diff = await git.uncommittedDiff(targetDir);
        const stepPlan = `${ctx.approvedPlan}\n\n=== 지금 검증할 단계 (${ctx.index}/${ctx.total}) ===\n${ctx.description}`;
        reviews = await this.review(reporter, reviewers, {
          approvedPlan: stepPlan,
          diff,
          cwd: targetDir,
          attempt,
          previousFailures: failures.slice(),
          parentId: buildStep.id,
          order,
        });
      }

      const passed =
        reviewers.length === 0 ||
        (reviews.length > 0 &&
          (config.reviewPolicy === "any"
            ? reviews.some((r) => r.result.passed)
            : reviews.every((r) => r.result.passed)));
      const lastReviewStepId = reviews[reviews.length - 1]?.stepId ?? buildStep.id;

      // 💬 each reviewer replies to the builder with its verdict (team chat).
      // The reviewer's identity key (name: 품질/보안/통합/빌드) rides in `engine`
      // so the dashboard seats the turn with the right teammate — two codex
      // reviewers share an engine, so engine alone is ambiguous.
      for (const r of reviews) {
        await reporter.chat({
          role: "verify",
          attempt,
          kind: "verify",
          toRole: "build",
          stepLabel: tag,
          passed: r.result.passed,
          engine: r.reviewer.name,
          agent: REVIEWER_AGENT_ID[r.reviewer.name],
          text: r.result.reason,
        });
      }

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
        const reviewerNames = reviews.map((r) => r.reviewer.name).join(", ") || "검증 생략";
        const verifiedLine =
          reviews.length > 0
            ? `Verified by ${reviewerNames} (attempt ${attempt}).`
            : `No verifiers on this run (검증 생략, attempt ${attempt}).`;
        const message = `${title} — ${tag}\n\n${ctx.description}\n\n${verifiedLine}`;
        const sha = await git.commitAll(targetDir, message);
        await commitStep.finish(
          "passed",
          reviews.length > 0
            ? `${tag} 검증 통과 후 ${sha.slice(0, 10)} 커밋.`
            : `${tag} 검증 생략 — ${sha.slice(0, 10)} 커밋.`
        );
        await reporter.log(
          "commit",
          `${tag} 커밋 ${sha.slice(0, 10)} ✅ (${reviews.length > 0 ? `${reviewerNames} 통과, ` : "검증 생략, "}${attempt}번째 시도)`
        );
        await reporter.chat({
          role: "system",
          attempt,
          kind: "commit",
          stepLabel: tag,
          text: `${reviews.length > 0 ? `${reviewerNames} 통과` : "검증 생략"} → ${sha.slice(0, 10)} 커밋 완료.`,
        });
        return { passed: true, lastStepId: commitStep.id, sha, failures };
      }

      // Feed every failing reviewer's reason back into the next attempt.
      feedback = reviews
        .filter((r) => !r.result.passed)
        .map((r) => `[${r.reviewer.name}] ${r.result.reason}`)
        .join("\n\n");
      failures.push(feedback);
      parentId = lastReviewStepId;
    }

    return { passed: false, lastStepId: parentId, sha: "", feedback, failures };
  }

  // Run every reviewer over the same diff in parallel, each as its own step.
  // parentId is the build step in the normal loop, or null for a verify-only
  // run's root-level audit.
  private async review(
    reporter: RunReporter,
    reviewers: Reviewer[],
    ctx: {
      approvedPlan: string;
      diff: string;
      cwd: string;
      attempt: number;
      previousFailures: string[];
      parentId: string | null;
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
          agent: REVIEWER_AGENT_ID[reviewer.name],
          attempt: ctx.attempt,
          parentId: ctx.parentId,
          orderIdx: ctx.order(),
        });
        // model carries the reviewer's identity key (품질/보안/통합/빌드) so the
        // dashboard can seat each log line with the right teammate — engine alone
        // can't tell the two codex reviewers apart.
        await step.log("verify", `${reviewer.name} 검토 중…`, { model: reviewer.name });
        const result = await reviewer.review({
          cwd: ctx.cwd,
          plan: ctx.approvedPlan,
          diff: ctx.diff,
          attempt: ctx.attempt,
          previousFailures: ctx.previousFailures,
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
          { level: result.passed ? "info" : "warn", model: reviewer.name }
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
