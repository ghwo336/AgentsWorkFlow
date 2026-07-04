import { addProposals, loadAgentLessons } from "../agents/learn-store.js";
import type { RunReporter } from "../reporter.js";
import { compactAgentSummary, resumeOrder } from "./shared.js";
import type { PipelineDeps } from "./types.js";

// 리서치 모드 (상현 단독): 웹을 조사해 보고서를 작성한다. 코드 파이프라인과
// 달리 저장소/커밋이 없다 — 보고서 텍스트가 결과물이며, 최신 보고서는 Run.plan,
// 대화 전체(질문/보고서 스레드)는 팀 채팅(ChatMsg)에 쌓인다.
//
// 리서치는 한 방에 끝나지 않는다: reported 상태의 run에 후속 질문을 보내면
// (researchFollowUp) 이전 스레드를 맥락으로 이어서 조사한다 — 완료 상태가
// committed가 아니라 "reported"인 이유 (커밋이 없고, 대화가 닫히지 않으므로).

// 조사 한 사이클: 스텝 생성 → 리서처 실행(스레드 맥락 포함) → 보고서를 채팅에
// 남기고 → 방법론 교훈 후보를 제안함에. 성공 시 보고서 텍스트, 실패 시 null
// (상태 마감은 이미 처리됨).
async function runResearchCycle(
  deps: PipelineDeps,
  args: {
    runId: string;
    question: string;
    targetDir: string;
    reporter: RunReporter;
    order: () => number;
    history?: Array<{ role: "user" | "researcher"; text: string }>;
  }
): Promise<string | null> {
  const { researcher, config } = deps;
  const { reporter } = args;
  const followUp = !!args.history?.length;
  const step = await reporter.startStep({
    kind: "research",
    label: followUp ? "후속 리서치" : "리서치",
    engine: "claude",
    model: config.researchModel,
    agent: "sanghyun",
    orderIdx: args.order(),
  });
  await step.log(
    "research",
    followUp
      ? `상현이 후속 질문을 조사합니다 (${config.researchModel})…`
      : `상현이 조사를 시작합니다 (${config.researchModel})…`
  );

  // 상현의 승인된 방법론 교훈 — 제안함에서 사용자가 승인한 것만 주입된다.
  const result = await researcher.research(
    {
      question: args.question,
      cwd: args.targetDir,
      learned: loadAgentLessons("sanghyun"),
      history: args.history,
    },
    step
  );
  if (result.isError || !result.text) {
    await step.finish("failed", "리서치 보고서를 작성하지 못했습니다.");
    await reporter.status("failed", { error: "리서치 보고서를 작성하지 못했습니다." });
    return null;
  }

  const report = compactAgentSummary(result.text, "리서치 보고서");
  await step.finish("passed", report);
  // 보고서를 팀 채팅에 남긴다 — 리서치 탭의 대화 스레드가 이 기록으로 그려진다.
  await reporter.chat({
    role: "research",
    attempt: 1,
    kind: "note",
    toRole: "user",
    stepLabel: followUp ? "후속 리서치" : "리서치",
    agent: "sanghyun",
    text: report,
  });

  // 상현이 스스로 제안한 조사-방법 교훈 → 제안함 (승인 전에는 주입되지 않음).
  if (result.lessons.length > 0) {
    const project = (await deps.store.getProject(args.runId)) ?? "default";
    const added = addProposals(
      result.lessons.map((l) => ({ ...l, agentId: "sanghyun" })),
      { project, runId: args.runId }
    );
    if (added > 0) {
      await reporter.log(
        "research",
        `상현이 조사 방법 교훈 ${added}건을 제안함에 등록했습니다 🧠 (팀 소개 탭에서 승인/거절)`
      );
    }
  }
  return report;
}

// 최초 리서치: 질문(brief) 하나로 시작해 보고서를 내고 reported로 마감한다.
export async function research(
  deps: PipelineDeps,
  runId: string,
  question: string,
  targetDir: string,
  reporter: RunReporter
): Promise<void> {
  const order = await resumeOrder(deps, runId);
  await reporter.status("researching");
  const report = await runResearchCycle(deps, { runId, question, targetDir, reporter, order });
  if (report === null) return; // 이미 failed로 마감됨
  await reporter.status("reported", { plan: report });
  await reporter.log("research", "리서치 완료 ✅ — 후속 질문을 이어서 할 수 있어요.");
}

// 후속 질문: reported 상태의 리서치 run에 질문을 더한다. 이전 스레드(질문/
// 보고서)를 맥락으로 넘기고, 새 보고서를 같은 run에 이어 붙인다. Run.plan은
// 항상 최신 보고서.
export async function researchFollowUp(
  deps: PipelineDeps,
  runId: string,
  question: string,
  targetDir: string,
  reporter: RunReporter
): Promise<void> {
  const order = await resumeOrder(deps, runId);
  const st = await deps.store.getResumeState(runId);
  if (!st) return;
  // 스레드 = 최초 질문(brief) + 이후의 질문/보고서 채팅 기록 (새 질문은 아직
  // 기록 전이므로 포함되지 않는다).
  const thread = await deps.store.getResearchThread(runId);
  const history: Array<{ role: "user" | "researcher"; text: string }> = [
    { role: "user", text: st.brief },
    ...thread,
  ];

  // 사용자 질문을 스레드에 기록 — 다음 후속 질문의 맥락이자 대화 UI의 말풍선.
  await reporter.chat({
    role: "user",
    attempt: 1,
    kind: "note",
    toRole: "research",
    stepLabel: "후속 리서치",
    text: question,
  });
  await reporter.status("researching");
  const report = await runResearchCycle(deps, { runId, question, targetDir, reporter, order, history });
  if (report === null) return;
  await reporter.status("reported", { plan: report });
  await reporter.log("research", "후속 리서치 완료 ✅");
}
