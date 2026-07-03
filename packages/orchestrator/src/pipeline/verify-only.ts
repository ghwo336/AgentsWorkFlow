import { REVIEWER_AGENT_ID, type RunRoster } from "@agent-loop/shared/roster";
import type { RunReporter } from "../reporter.js";
import { resumeOrder, reviewersFor, runReviewFanout } from "./shared.js";
import type { PipelineDeps } from "./types.js";

// 검증 전용 모드 (검증자만 참여): audit the project's CURRENT state instead of
// reviewing a fresh diff. Each selected reviewer inspects the working copy
// through its own lens; all pass → 완료, any fail → failed with the reasons.
export async function verifyOnly(
  deps: PipelineDeps,
  runId: string,
  brief: string,
  targetDir: string,
  reporter: RunReporter,
  roster: RunRoster
): Promise<void> {
  const { git } = deps;
  await git.ensureRepo(targetDir);
  const reviewers = reviewersFor(deps, roster);
  if (reviewers.length === 0) {
    await reporter.status("failed", { error: "선택된 검증 에이전트가 없습니다." });
    return;
  }
  const order = await resumeOrder(deps, runId);
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

  const reviews = await runReviewFanout(reporter, reviewers, {
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
