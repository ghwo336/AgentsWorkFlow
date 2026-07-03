// The agent roster — the single vocabulary for "who can be on a run's team".
// The orchestrator uses it to gate pipeline phases (기획/개발/검증) and filter
// the reviewer fan-out; the dashboard uses it for the picker UI and to seat
// steps/usage with the right pixel character. Visuals (avatars, colors) stay in
// the dashboard's cast.ts — this module is engine-side identity only.
//
// The unit of selection is a SEAT (role × person): Run.agents stores seat keys
// ("build:minjae"), so a person could hold seats in two roles without the
// selection becoming ambiguous. Currently every person holds exactly one seat.

export type RosterRole = "plan" | "build" | "verify";

export interface RosterSeat {
  key: string; // "build:juho" — stored in Run.agents
  agentId: string; // person id, stamped on Step/ChatMsg/Usage rows ("juho")
  name: string; // 주호
  role: RosterRole;
  // The reviewer identity key(s) this verify seat owns in the pipeline fan-out
  // (Reviewer.name). 성호 also owns the optional TEST_CMD reviewer ("tests").
  reviewerNames?: string[];
}

export const SEATS: RosterSeat[] = [
  { key: "plan:hojae", agentId: "hojae", name: "호재", role: "plan" },
  { key: "build:taekyung", agentId: "taekyung", name: "태경", role: "build" },
  { key: "build:minjae", agentId: "minjae", name: "민재", role: "build" },
  { key: "verify:juho", agentId: "juho", name: "주호", role: "verify", reviewerNames: ["품질"] },
  { key: "verify:donghwan", agentId: "donghwan", name: "동환", role: "verify", reviewerNames: ["보안"] },
  { key: "verify:yujun", agentId: "yujun", name: "유준", role: "verify", reviewerNames: ["통합"] },
  { key: "verify:seongho", agentId: "seongho", name: "성호", role: "verify", reviewerNames: ["빌드", "tests"] },
];

export const ALL_SEAT_KEYS = SEATS.map((s) => s.key);

const byKey = new Map(SEATS.map((s) => [s.key, s]));

export function seatsOf(role: RosterRole): RosterSeat[] {
  return SEATS.filter((s) => s.role === role);
}

// Reviewer identity key ("품질"/"보안"/"tests"…) → person agent id, so the
// pipeline can stamp each review step/usage with its owner.
export const REVIEWER_AGENT_ID: Record<string, string> = Object.fromEntries(
  SEATS.flatMap((s) => (s.reviewerNames ?? []).map((n) => [n, s.agentId]))
);

// A run's team, resolved from the stored selection. `null` selection = 전원
// (legacy runs recorded before agent selection existed).
export interface RunRoster {
  planner: boolean; // 호재 참여 여부 (계획 + 에스컬레이션)
  builderIds: string[]; // 참여 개발자의 person id (attempt 순환 배정 순서)
  reviewerNames: string[]; // fan-out에 포함할 Reviewer.name 목록
  verifierIds: string[]; // 참여 검증자의 person id (표시용)
}

// Parse a Run.agents JSON column (seat keys). null/invalid/empty → null (= 전원).
export function parseAgents(json: string | null | undefined): string[] | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return null;
    const keys = arr.map(String).filter((k) => byKey.has(k));
    return keys.length > 0 ? keys : null;
  } catch {
    return null;
  }
}

export function rosterOf(keys: string[] | null | undefined): RunRoster {
  const selected = keys && keys.length > 0 ? keys.filter((k) => byKey.has(k)) : ALL_SEAT_KEYS;
  const seats = selected.map((k) => byKey.get(k)!);
  const of = (role: RosterRole) => seats.filter((s) => s.role === role);
  const verify = of("verify");
  return {
    planner: of("plan").length > 0,
    builderIds: of("build").map((s) => s.agentId),
    verifierIds: verify.map((s) => s.agentId),
    reviewerNames: verify.flatMap((s) => s.reviewerNames ?? []),
  };
}

// Validate a user-supplied selection STRICTLY — the API boundary rejects what
// this flags, so unknown keys never reach the DB and an empty list never
// silently means "전원". Returns a Korean error message, or null when runnable:
//   - 개발 포함: 기획/검증은 자유 (기획 없음 = 바로 구현, 검증 없음 = 리뷰 생략)
//   - 검증만: 프로젝트 현재 상태 감사 (기획/개발 없음)
//   - 기획만: 계획서만 작성하고 종료
export function validateAgents(keys: string[]): string | null {
  if (keys.length === 0) return "참여할 에이전트를 한 명 이상 선택하세요.";
  const unknown = keys.filter((k) => !byKey.has(k));
  if (unknown.length > 0) return `알 수 없는 에이전트입니다: ${unknown.join(", ")}`;
  const r = rosterOf(keys);
  if (r.builderIds.length === 0 && r.planner && r.verifierIds.length > 0) {
    return "개발 에이전트 없이 기획과 검증을 함께 선택할 수 없습니다 — 개발자를 추가하거나 하나만 선택하세요.";
  }
  return null;
}
