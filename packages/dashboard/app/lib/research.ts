// 리서치 팀 공용 상수/헬퍼 — 리서치 탭을 이루는 컴포넌트들(폴더 줄, 새 리서치
// 폼, 스레드)이 함께 쓴다. 프로젝트 예약 이름(RESEARCH_PROJECT)은 agents.tsx.

export const X_RESEARCHER = "sanghyun"; // 상현 (Grok — X 실시간)
export const WEB_RESEARCHER = "yerim"; // 예림 (Claude — 웹 전반)
export const RESEARCH_SEATS = [`research:${X_RESEARCHER}`, `research:${WEB_RESEARCHER}`];

// 리서치 화면용 상태 라벨 — 코드 파이프라인 어휘(committed)를 그대로 노출하지
// 않는다. committed는 reported 도입 전의 리서치 run (하위 호환).
const STATUS_LABEL: Record<string, string> = {
  reported: "완료",
  committed: "완료",
  researching: "조사 중",
  planning: "준비 중",
  failed: "실패",
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
export const isRunning = (s: string) => s === "researching" || s === "planning";
