import type { RunReporter } from "../reporter.js";
import { loadBuildState } from "./build-state.js";
import { planOnce, resumeOrder } from "./shared.js";
import { executeSteps } from "./step-runner.js";
import { applyTeamStaffing, assignableDevsFor } from "./team-staffing.js";
import type { PipelineDeps } from "./types.js";

// The FULL pipeline mode: plan → ★approve → per-step build/verify/commit loop.
// This module owns ONLY the plan/approve entry points and the resume-aware
// build kick-off; the step loop + 호재 escalation live in step-runner.ts, the
// needs_input resume in intervention.ts, restart-safe state loading in
// build-state.ts, and team staffing policy in team-staffing.ts.
//
// Alongside run-level status the collaborators emit a Step (an agent work span)
// for each phase — plan, each build attempt, and each verify — so the dashboard
// can render the process as a timeline / node graph / kanban off one data source.

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
