import type { InterventionDecision } from "@agent-loop/shared/types";
import type { RunReporter } from "../reporter.js";
import { loadBuildState } from "./build-state.js";
import { executeSteps } from "./step-runner.js";
import type { PipelineDeps } from "./types.js";

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
