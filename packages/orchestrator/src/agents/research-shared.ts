// Engine-neutral prompt/parsing helpers shared by every researcher adapter
// (예림=claude-researcher.ts, 상현=grok-agent.ts) and the build/plan prompts.
// Lives outside any engine adapter so adapters never import each other.

// 팀 학습 노트 프롬프트 블록 — learn-store가 렌더링한 교훈 불릿을 싣는다.
// 교훈은 전부 [조건] 접두를 달고 있으므로, 조건이 맞을 때만 따르라고 명시한다.
export function learnedBlock(learned: string | undefined): string {
  if (!learned) return "";
  return [
    `# 팀 학습 노트 (과거 run에서 배운 것 — 각 항목의 [조건]이 이 작업에 해당할 때만 적용)`,
    learned,
  ].join("\n");
}

// 후속 리서치의 스레드 맥락 블록. 각 턴은 길이 상한을 두고(보고서가 길다) 최근
// 턴 위주로 자른다. 보고서 턴의 화자 접두("(예림의 보고서)")는 pipeline이 이미
// 붙여서 넘기므로 여기 라벨은 중립적인 "[이전 보고서]"다.
export function researchHistoryBlock(
  history: Array<{ role: "user" | "researcher"; text: string }> | undefined
): string {
  if (!history?.length) return "";
  return [
    `# 지금까지의 리서치 대화 (맥락 — 이미 답한 내용은 반복하지 말 것)`,
    ...history
      .slice(-8)
      .map((t) => `${t.role === "user" ? "[질문]" : "[이전 보고서]"}\n${t.text.slice(0, 4000)}`),
  ].join("\n\n");
}

// 리서처 출력에서 ```lessons 블록을 떼어낸다 — 보고서 본문(사용자가 읽는 것)과
// 교훈 후보(제안함으로 가는 것)를 분리. 파싱 실패는 교훈 없음으로 취급한다.
export function splitResearchLessons(text: string): {
  report: string;
  lessons: Array<{ condition: string; lesson: string; evidence: string }>;
} {
  const m = text.match(/```lessons\s*([\s\S]*?)```/);
  if (!m) return { report: text, lessons: [] };
  const report = text.replace(m[0], "").trim();
  try {
    const arr = JSON.parse(m[1]);
    const lessons = (Array.isArray(arr) ? arr : [])
      .filter(
        (v: any) =>
          typeof v?.condition === "string" && typeof v?.lesson === "string" && typeof v?.evidence === "string"
      )
      .slice(0, 2);
    return { report, lessons };
  } catch {
    return { report, lessons: [] };
  }
}
