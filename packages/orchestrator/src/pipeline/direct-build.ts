import type { RunReporter } from "../reporter.js";
import { build } from "./full.js";
import type { PipelineDeps } from "./types.js";

// 기획 생략 모드 (호재 미참여): the brief itself becomes the "approved plan"
// as a single step — no approval gate — and the build/verify loop starts
// immediately. Persisted like an approved plan so restart/retry resume works.
export async function directBuild(
  deps: PipelineDeps,
  runId: string,
  brief: string,
  targetDir: string,
  reporter: RunReporter
): Promise<void> {
  await deps.git.ensureRepo(targetDir);
  await deps.store.savePlan(runId, brief);
  await deps.store.saveSteps(runId, [brief]);
  await reporter.log("approval", "기획 에이전트 없이 시작 — 요구사항을 그대로 구현합니다 (승인 단계 생략).");
  await reporter.status("building");
  await build(deps, runId, reporter);
}
