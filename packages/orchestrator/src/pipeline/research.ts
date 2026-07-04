import type { RunReporter } from "../reporter.js";
import { compactAgentSummary, resumeOrder } from "./shared.js";
import type { PipelineDeps } from "./types.js";

// 리서치 전용 모드 (상현 단독): 웹을 조사해 보고서를 작성하고 종료한다.
// 코드 파이프라인과 달리 저장소/커밋이 없다 — 보고서 텍스트가 결과물이며,
// planOnly처럼 Run.plan에 저장돼 대시보드가 그대로 렌더링한다.
export async function research(
  deps: PipelineDeps,
  runId: string,
  question: string,
  targetDir: string,
  reporter: RunReporter
): Promise<void> {
  const { researcher, config } = deps;
  const order = await resumeOrder(deps, runId);
  await reporter.status("researching");
  const step = await reporter.startStep({
    kind: "research",
    label: "리서치",
    engine: "claude",
    model: config.researchModel,
    agent: "sanghyun",
    orderIdx: order(),
  });
  await step.log("research", `상현이 조사를 시작합니다 (${config.researchModel})…`);

  const result = await researcher.research({ question, cwd: targetDir }, step);
  if (result.isError || !result.text) {
    await step.finish("failed", "리서치 보고서를 작성하지 못했습니다.");
    await reporter.status("failed", { error: "리서치 보고서를 작성하지 못했습니다." });
    return;
  }

  const report = compactAgentSummary(result.text, "리서치 보고서");
  await step.finish("passed", report);
  // 보고서를 팀 채팅에도 남겨 대화 뷰에서 상현의 발화로 보이게 한다.
  await reporter.chat({
    role: "research",
    attempt: 1,
    kind: "note",
    toRole: "user",
    stepLabel: "리서치",
    agent: "sanghyun",
    text: report,
  });
  await reporter.status("committed", { plan: report });
  await reporter.log("research", "리서치 완료 ✅ — 보고서를 작성했습니다.");
}
