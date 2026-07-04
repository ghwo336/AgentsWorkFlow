import { rosterOf, type RunRoster } from "@agent-loop/shared/roster";
import type { RunReporter } from "../reporter.js";
import { resumeOrder } from "./shared.js";
import type { PipelineDeps } from "./types.js";

// Shared prologue for build/resume: everything a resumed run needs to continue
// (approved plan, decomposed steps, workspace, roster), loaded from the DB so
// it works even if this process didn't produce the plan (restart-safe).

export interface BuildState {
  plan: string;
  steps: string[];
  stepDevs: (string | null)[];
  brief: string;
  targetDir: string;
  project: string; // 팀 학습 노트 스코프 키
  planStepId: string;
  order: () => number;
  roster: RunRoster;
}

// Load the approved plan + steps and ensure the repo, or mark the run failed
// and return null.
export async function loadBuildState(
  deps: PipelineDeps,
  runId: string,
  reporter: RunReporter
): Promise<BuildState | null> {
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
    project: st.project,
    planStepId,
    order,
    roster: rosterOf(st.agents),
  };
}
