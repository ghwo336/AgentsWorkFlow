import { REVIEWER_AGENT_ID, rosterOf, type RunRoster } from "@agent-loop/shared/roster";
import type { InterventionDecision } from "@agent-loop/shared/types";
import type { RunReporter } from "../reporter.js";
import {
  builderFor,
  compactAgentSummary,
  planOnce,
  resumeOrder,
  reviewersFor,
  runReviewFanout,
  type ReviewOutcome,
} from "./shared.js";
import { applyTeamStaffing, assignableDevsFor } from "./team-staffing.js";
import type { PipelineDeps } from "./types.js";

// The FULL pipeline mode: plan → ★approve → per-step build/verify/commit loop
// with the 호재 escalation ladder. This module owns ONLY that state machine;
// team staffing policy lives in team-staffing.ts and the reviewer fan-out /
// plan step are shared collaborators (shared.ts).
//
// Alongside run-level status it emits a Step (an agent work span) for each
// phase — plan, each build attempt, and each verify — so the dashboard can
// render the process as a timeline / node graph / kanban off one data source.

// ①★ PLAN → park at approval. Opus proposes a plan; we persist the plan text +
// its decomposed steps and set the run to awaiting_approval, then RETURN — we
// do NOT hold the approval in memory. The approval is resolved out-of-band
// (runner.resolveApproval) by reading the DB, so a pending approval survives an
// orchestrator restart. Used for the initial plan and for a revise (feedback →
// re-plan).
export async function plan(
  deps: PipelineDeps,
  runId: string,
  brief: string,
  targetDir: string,
  reporter: RunReporter,
  opts: {
    previousPlan?: string;
    feedback?: string;
    suggestTeam?: boolean;
    // 이 run에서 단계를 배정받을 수 있는 개발자 person id들 (수동 선택 run은
    // 선택된 개발자만, 자동 배치 run은 전원 — runner가 채운다).
    builderIds?: string[];
  } = {}
): Promise<void> {
  await deps.git.ensureRepo(targetDir);
  const order = await resumeOrder(deps, runId);
  const planned = await planOnce(deps, brief, targetDir, reporter, order, {
    previousPlan: opts.previousPlan,
    feedback: opts.feedback,
    suggestTeam: opts.suggestTeam,
    assignableDevs: assignableDevsFor(opts.builderIds),
  });
  if (planned === null) return; // planOnce already marked the run failed

  const devs = await applyTeamStaffing({
    deps,
    runId,
    reporter,
    suggestTeam: opts.suggestTeam,
    builderIds: opts.builderIds,
    planned,
  });
  await deps.store.saveSteps(runId, planned.steps, devs);
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
export async function build(deps: PipelineDeps, runId: string, reporter: RunReporter): Promise<void> {
  const st = await loadBuildState(deps, runId, reporter);
  if (!st) return;
  const { committedCount, lastCommitStepId } = await deps.store.getResumePoint(runId);
  const startIdx = Math.min(committedCount, st.steps.length);
  await executeSteps(deps, {
    runId,
    approvedPlan: st.plan,
    steps: st.steps,
    stepDevs: st.stepDevs,
    brief: st.brief,
    targetDir: st.targetDir,
    reporter,
    order: st.order,
    roster: st.roster,
    seedParentId: lastCommitStepId ?? st.planStepId,
    startIdx,
  });
}

// Resume a run parked at needs_input, per the user's decision on the stuck step:
//  - guide: re-run the stuck step with the user's guidance seeded as feedback
//  - commit: accept the current (rejected) diff as-is and move to the next step
//  - skip:   throw away the stuck step's changes and move on
//  - abort:  reject the run
export async function resumeFromInput(
  deps: PipelineDeps,
  runId: string,
  reporter: RunReporter,
  decision: InterventionDecision
): Promise<void> {
  if (decision.action === "abort") {
    await reporter.log("approval", "사용자가 막힌 단계에서 작업을 중단했습니다.", { level: "warn" });
    await reporter.status("rejected", { error: "사용자가 막힌 단계에서 작업을 중단했습니다." });
    return;
  }

  const st = await loadBuildState(deps, runId, reporter);
  if (!st) return;
  const { git, store } = deps;
  const { committedCount, lastCommitStepId } = await store.getResumePoint(runId);
  const stuckIdx = Math.min(committedCount, st.steps.length - 1);
  const stuckTag = `단계 ${stuckIdx + 1}/${st.steps.length}`;
  const parent = lastCommitStepId ?? st.planStepId;

  const continueFrom = (fromIdx: number, seedParentId: string, seedFeedback?: string) =>
    executeSteps(deps, {
      runId,
      approvedPlan: st.plan,
      steps: st.steps,
      stepDevs: st.stepDevs,
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
async function loadBuildState(
  deps: PipelineDeps,
  runId: string,
  reporter: RunReporter
): Promise<
  | {
      plan: string;
      steps: string[];
      stepDevs: (string | null)[];
      brief: string;
      targetDir: string;
      planStepId: string;
      order: () => number;
      roster: RunRoster;
    }
  | null
> {
  const st = await deps.store.getResumeState(runId);
  if (!st || !st.targetDir || !st.plan) {
    await reporter.status("failed", { error: "재개할 계획 정보가 없습니다." });
    return null;
  }
  await deps.git.ensureRepo(st.targetDir);
  const order = await resumeOrder(deps, runId);
  const planStepId = (await deps.store.getPlanStepId(runId)) ?? "";
  // Fall back to the whole plan as a single step for runs planned before steps
  // were persisted.
  const steps = st.steps.length > 0 ? st.steps : [st.plan];
  return {
    plan: st.plan,
    steps,
    stepDevs: st.stepDevs,
    brief: st.brief,
    targetDir: st.targetDir,
    planStepId,
    order,
    roster: rosterOf(st.agents),
  };
}

// ②③④ Walk the plan step by step from `startIdx`. Each step is implemented
// (Sonnet), verified (codex) and committed on its own; a step that keeps
// failing escalates to 호재 (Opus) and, if still stuck, parks the run at
// needs_input for the user instead of killing the whole run.
async function executeSteps(
  deps: PipelineDeps,
  args: {
    runId: string;
    approvedPlan: string;
    steps: string[];
    stepDevs?: (string | null)[]; // 단계별 담당 개발자 (계획에서 배정)
    brief: string;
    targetDir: string;
    reporter: RunReporter;
    order: () => number;
    roster: RunRoster;
    seedParentId: string;
    startIdx: number;
    seedFeedbackForFirst?: string;
  }
): Promise<void> {
  const { runId, approvedPlan, steps, brief, targetDir, reporter, order, roster } = args;
  const { git } = deps;
  // Chain parent: the first (resumed) step hangs off seedParentId (plan step,
  // or the previous step's commit); each next step hangs off the previous
  // step's commit, so the node graph is one connected spine.
  let parentId = args.seedParentId;
  let lastSha = "";
  const completed = steps.slice(0, args.startIdx);

  for (let i = args.startIdx; i < steps.length; i++) {
    const outcome = await runStep(deps, {
      runId,
      approvedPlan,
      brief,
      targetDir,
      reporter,
      order,
      roster,
      parentId,
      description: steps[i],
      assignedDev: args.stepDevs?.[i] ?? undefined,
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

interface StepCtx {
  runId: string;
  approvedPlan: string;
  brief: string;
  targetDir: string;
  reporter: RunReporter;
  order: () => number;
  roster: RunRoster;
  parentId: string;
  description: string;
  assignedDev?: string; // 이 단계의 담당 개발자 person id (계획에서 배정)
  index: number;
  total: number;
  completed: string[];
  seedFeedback?: string;
}

// One plan step with the escalation ladder: round 1 (builders retry up to
// maxVerifyRetries) → 호재(Opus) intervention → round 2 (builders retry again,
// armed with the lead's guidance). Still failing → not passed (→ needs_input).
async function runStep(
  deps: PipelineDeps,
  ctx: StepCtx
): Promise<{ passed: boolean; lastStepId: string; sha: string; feedback?: string }> {
  const { config } = deps;
  const { reporter } = ctx;
  const tag = `단계 ${ctx.index}/${ctx.total}`;

  // Round 1 — builders try on their own (seeded with the user's guidance if
  // this is a post-intervention resume).
  const r1 = await runStepRound(deps, ctx, { seedFeedback: ctx.seedFeedback, attemptOffset: 0 });
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
  const escal = await escalate(deps, ctx, r1);

  // Round 2 — same builders, now following the lead's fix plan. Reviewers get
  // round 1's rejections as history so they converge instead of re-litigating.
  const r2 = await runStepRound(
    deps,
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
async function escalate(
  deps: PipelineDeps,
  ctx: Pick<StepCtx, "approvedPlan" | "targetDir" | "reporter" | "order" | "description" | "index" | "total">,
  round1: { lastStepId: string; failures: string[] }
): Promise<{ guidance: string; stepId: string }> {
  const { planner, git, config } = deps;
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
    attempt: config.maxVerifyRetries,
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
async function runStepRound(
  deps: PipelineDeps,
  ctx: StepCtx,
  opts: { seedFeedback?: string; attemptOffset: number; previousFailures?: string[] }
): Promise<{ passed: boolean; lastStepId: string; sha: string; feedback?: string; failures: string[] }> {
  const { git, store, config } = deps;
  const reviewers = reviewersFor(deps, ctx.roster);
  const { reporter, targetDir, order } = ctx;
  const tag = `단계 ${ctx.index}/${ctx.total}`;
  let feedback: string | undefined = opts.seedFeedback;
  let parentId = ctx.parentId;
  // Seeded with the prior round's rejections (if any) so reviewers see the
  // whole rejection history for this step, not just this round's.
  const failures: string[] = [...(opts.previousFailures ?? [])];

  for (let n = 1; n <= config.maxVerifyRetries; n++) {
    const attempt = opts.attemptOffset + n; // global attempt no. (round 2 → 6..10)
    // 담당 배정이 있으면 재시도 포함 모든 attempt를 그 전문가가 잡는다 —
    // 스택이 맞는 사람이 계속 파는 것이, 무관한 전문가에게 넘기는 것보다 낫다.
    // 배정이 없을 때만 (레거시/기획 생략) attempt 순환으로 교대.
    const builderId =
      ctx.assignedDev && ctx.roster.builderIds.includes(ctx.assignedDev)
        ? ctx.assignedDev
        : builderFor(ctx.roster, attempt);
    // The assigned teammate's own builder (their specialty harness); fall back
    // to the generic builder for unknown/legacy ids.
    const builder = (builderId && deps.buildersById?.[builderId]) || deps.builder;
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
    let reviews: ReviewOutcome[] = [];
    if (reviewers.length > 0) {
      await reporter.status("verifying");
      const diff = await git.uncommittedDiff(targetDir);
      const stepPlan = `${ctx.approvedPlan}\n\n=== 지금 검증할 단계 (${ctx.index}/${ctx.total}) ===\n${ctx.description}`;
      reviews = await runReviewFanout(reporter, reviewers, {
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
