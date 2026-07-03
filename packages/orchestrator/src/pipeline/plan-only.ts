import type { RunReporter } from "../reporter.js";
import { planOnce, resumeOrder } from "./shared.js";
import type { PipelineDeps } from "./types.js";

// 기획 전용 모드 (호재만 참여): produce the plan document and finish — there
// is no builder to hand it to, so the run completes at the plan.
export async function planOnly(
  deps: PipelineDeps,
  runId: string,
  brief: string,
  targetDir: string,
  reporter: RunReporter
): Promise<void> {
  await deps.git.ensureRepo(targetDir);
  const order = await resumeOrder(deps, runId);
  const planned = await planOnce(deps, brief, targetDir, reporter, order);
  if (planned === null) return; // planOnce already marked the run failed
  await deps.store.saveSteps(runId, planned.steps);
  await reporter.status("committed", { plan: planned.text });
  await reporter.log("plan", "기획 전용 작업 — 계획서 작성을 완료했습니다 ✅ (구현 없이 종료)");
}
