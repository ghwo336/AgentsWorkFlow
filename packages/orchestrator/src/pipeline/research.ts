import type { RunRoster } from "@agent-loop/shared/roster";
import { addProposals, loadAgentLessons } from "../agents/learn-store.js";
import type { RunReporter } from "../reporter.js";
import { compactAgentSummary, resumeOrder } from "./shared.js";
import type { PipelineDeps, ResearcherSeat } from "./types.js";

// 리서치 모드: 선택된 리서처 전원이 같은 질문을 동시에(팬아웃) 조사한다 —
// 상현(Grok)은 X 실시간, 예림(Claude)은 X 밖 웹 전반. 각자 자기 스텝과 채팅
// 말풍선을 남기므로 스레드에는 두 보고서가 나란히 쌓인다.
//
// 코드 파이프라인과 달리 저장소/커밋이 없다 — 보고서가 결과물이며, 최신 통합
// 보고서는 Run.plan, 대화 전체(질문/보고서 스레드)는 팀 채팅(ChatMsg)에 쌓인다.
//
// 리서치는 한 방에 끝나지 않는다: reported 상태의 run에 후속 질문을 보내면
// (researchFollowUp) 이전 스레드를 맥락으로 이어서 조사한다 — 완료 상태가
// committed가 아니라 "reported"인 이유 (커밋이 없고, 대화가 닫히지 않으므로).

// 이 run에 참여하는 리서처들 — 로스터 선택과 교집합, 없으면(레거시/미선택) 전원.
function researchersFor(deps: PipelineDeps, roster: RunRoster): ResearcherSeat[] {
  const selected = deps.researchers.filter((r) => roster.researcherIds.includes(r.agentId));
  return selected.length > 0 ? selected : deps.researchers;
}

// 리서처 한 명의 조사 한 사이클: 스텝 생성 → 실행(스레드 맥락 포함) → 보고서를
// 채팅에 남기고 → 방법론 교훈 후보를 제안함에. 성공 시 보고서, 실패 시 null.
// 팬아웃의 한 갈래라 실패해도 throw하지 않는다 — 동료의 보고서는 살아야 한다.
async function runResearchCycle(
  deps: PipelineDeps,
  seat: ResearcherSeat,
  args: {
    runId: string;
    question: string;
    targetDir: string;
    reporter: RunReporter;
    order: () => number;
    history?: Array<{ role: "user" | "researcher"; text: string }>;
  }
): Promise<string | null> {
  const { reporter } = args;
  const followUp = !!args.history?.length;
  const label = `${followUp ? "후속 리서치" : "리서치"}: ${seat.name}`;
  const step = await reporter.startStep({
    kind: "research",
    label,
    engine: seat.engine,
    model: seat.model,
    agent: seat.agentId,
    orderIdx: args.order(),
  });
  await step.log("research", `${seat.name}이(가) 조사를 시작합니다 (${seat.model})…`);

  try {
    // 승인된 개인 교훈(learn-store)은 그 리서처의 것만 주입된다.
    const result = await seat.researcher.research(
      {
        question: args.question,
        cwd: args.targetDir,
        learned: loadAgentLessons(seat.agentId),
        history: args.history,
      },
      step
    );
    if (result.isError || !result.text) {
      await step.finish("failed", `${seat.name}의 보고서 작성 실패`);
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
      stepLabel: label,
      agent: seat.agentId,
      text: report,
    });

    // 리서처가 스스로 제안한 조사-방법 교훈 → 제안함 (승인 전에는 주입 안 됨).
    if (result.lessons.length > 0) {
      const project = (await deps.store.getProject(args.runId)) ?? "default";
      const added = addProposals(
        result.lessons.map((l) => ({ ...l, agentId: seat.agentId })),
        { project, runId: args.runId }
      );
      if (added > 0) {
        await reporter.log(
          "research",
          `${seat.name}이(가) 조사 방법 교훈 ${added}건을 제안함에 등록했습니다 🧠 (팀 소개 탭에서 승인/거절)`
        );
      }
    }
    return report;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await step.log("research", `${seat.name} 조사 중 오류: ${msg.slice(0, 300)}`, { level: "error" });
    await step.finish("failed", `${seat.name}의 조사가 오류로 중단됨`);
    return null;
  }
}

// 팬아웃 실행 + 결과 정리: 하나라도 성공하면 reported, 전원 실패면 failed.
// Run.plan에는 성공한 보고서를 리서처 섹션으로 묶어 저장한다 (단독이면 그대로).
async function runFanout(
  deps: PipelineDeps,
  seats: ResearcherSeat[],
  args: {
    runId: string;
    question: string;
    targetDir: string;
    reporter: RunReporter;
    order: () => number;
    history?: Array<{ role: "user" | "researcher"; text: string }>;
  }
): Promise<void> {
  const { reporter } = args;
  const results = await Promise.all(
    seats.map(async (seat) => ({ seat, report: await runResearchCycle(deps, seat, args) }))
  );
  const ok = results.filter((r): r is { seat: ResearcherSeat; report: string } => r.report !== null);
  if (ok.length === 0) {
    await reporter.status("failed", { error: "리서치 보고서를 작성하지 못했습니다." });
    return;
  }
  const combined =
    ok.length === 1
      ? ok[0].report
      : ok.map((r) => `## ${r.seat.name}의 보고서 (${r.seat.engine})\n\n${r.report}`).join("\n\n---\n\n");
  await reporter.status("reported", { plan: combined });
  const failed = results.length - ok.length;
  await reporter.log(
    "research",
    `리서치 완료 ✅ (${ok.map((r) => r.seat.name).join("·")}${failed > 0 ? ` — ${failed}명 실패` : ""}) — 후속 질문을 이어서 할 수 있어요.`
  );
}

// 최초 리서치: 질문(brief) 하나로 시작해 보고서를 내고 reported로 마감한다.
export async function research(
  deps: PipelineDeps,
  runId: string,
  question: string,
  targetDir: string,
  reporter: RunReporter,
  roster: RunRoster
): Promise<void> {
  const order = await resumeOrder(deps, runId);
  await reporter.status("researching");
  await runFanout(deps, researchersFor(deps, roster), { runId, question, targetDir, reporter, order });
}

// 후속 질문: reported 상태의 리서치 run에 질문을 더한다. 이전 스레드(질문/
// 보고서)를 맥락으로 넘기고, 새 보고서들을 같은 run에 이어 붙인다.
export async function researchFollowUp(
  deps: PipelineDeps,
  runId: string,
  question: string,
  targetDir: string,
  reporter: RunReporter,
  roster: RunRoster
): Promise<void> {
  const order = await resumeOrder(deps, runId);
  const st = await deps.store.getResumeState(runId);
  if (!st) return;
  const seats = researchersFor(deps, roster);
  const nameOf = (agentId: string | null) =>
    deps.researchers.find((r) => r.agentId === agentId)?.name ?? "리서처";
  // 스레드 = 최초 질문(brief) + 이후의 질문/보고서 채팅 기록. 보고서 턴에는
  // 화자를 접두로 붙인다 — 두 리서처의 보고서가 섞여 있어 누구 말인지가 맥락이다.
  const thread = await deps.store.getResearchThread(runId);
  const history: Array<{ role: "user" | "researcher"; text: string }> = [
    { role: "user", text: st.brief },
    ...thread.map((t) =>
      t.role === "user"
        ? { role: "user" as const, text: t.text }
        : { role: "researcher" as const, text: `(${nameOf(t.agent)}의 보고서)\n${t.text}` }
    ),
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
  await runFanout(deps, seats, { runId, question, targetDir, reporter, order, history });
}
