// The agent roster — the single vocabulary for "who can be on a run's team".
// The orchestrator uses it to gate pipeline phases (기획/개발/검증) and filter
// the reviewer fan-out; the dashboard uses it for the picker UI and to seat
// steps/usage with the right pixel character. Visuals (avatars, colors) stay in
// the dashboard's cast.ts — this module is engine-side identity only.
//
// The unit of selection is a SEAT (role × person): Run.agents stores seat keys
// ("build:minjae"), so a person could hold seats in two roles without the
// selection becoming ambiguous. Currently every person holds exactly one seat.

export type RosterRole = "plan" | "build" | "verify" | "research";

// 리서치 run들이 담기는 예약 프로젝트 이름 — 대시보드 홈의 리서치 탭이 이
// 프로젝트만 보여주고, 프로젝트 탭 목록에서는 숨긴다.
export const RESEARCH_PROJECT = "리서치";

export interface RosterSeat {
  key: string; // "build:juho" — stored in Run.agents
  agentId: string; // person id, stamped on Step/ChatMsg/Usage rows ("juho")
  name: string; // 주호
  role: RosterRole;
  // Specialization shown in the picker/office (개발자만: 프론트엔드/백엔드/...).
  // Each dev also has a matching harness file: orchestrator/agents-config/<agentId>.md
  specialty?: string;
  // The reviewer identity key(s) this verify seat owns in the pipeline fan-out
  // (Reviewer.name). 성호 also owns the optional TEST_CMD reviewer ("tests").
  reviewerNames?: string[];
}

export const SEATS: RosterSeat[] = [
  { key: "plan:hojae", agentId: "hojae", name: "호재", role: "plan" },
  { key: "build:taekyung", agentId: "taekyung", name: "태경", role: "build", specialty: "프론트엔드" },
  { key: "build:minjae", agentId: "minjae", name: "민재", role: "build", specialty: "백엔드" },
  { key: "build:juhee", agentId: "juhee", name: "주희", role: "build", specialty: "iOS" },
  { key: "build:seongmin", agentId: "seongmin", name: "성민", role: "build", specialty: "Android" },
  { key: "build:yeonhan", agentId: "yeonhan", name: "연한", role: "build", specialty: "크로스플랫폼(RN)" },
  { key: "verify:juho", agentId: "juho", name: "주호", role: "verify", reviewerNames: ["품질"] },
  { key: "verify:donghwan", agentId: "donghwan", name: "동환", role: "verify", reviewerNames: ["보안"] },
  { key: "verify:yujun", agentId: "yujun", name: "유준", role: "verify", reviewerNames: ["통합"] },
  { key: "verify:seongho", agentId: "seongho", name: "성호", role: "verify", reviewerNames: ["빌드", "tests"] },
  { key: "research:sanghyun", agentId: "sanghyun", name: "상현", role: "research", specialty: "리서치" },
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
  researcher: boolean; // 상현 참여 여부 (리서치 전용 run)
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
    researcher: of("research").length > 0,
  };
}

// Which pipeline a roster runs. THE single place this combo logic lives —
// runner 분기, 검증 규칙, 대시보드의 모드 표시가 전부 여기서 파생된다.
//   full       기획 → 승인 → 구현/검증 (기본)
//   direct     기획 생략, 승인 없이 바로 구현
//   verifyOnly 검증자만 — 프로젝트 현재 상태 감사
//   planOnly   기획만 — 계획서 작성 후 종료
//   research   리서처만 — 웹 조사 후 보고서 작성 (코드 작업 없음)
export type RunMode = "full" | "direct" | "verifyOnly" | "planOnly" | "research";

export function runModeOf(roster: RunRoster): RunMode {
  if (roster.builderIds.length > 0) return roster.planner ? "full" : "direct";
  if (roster.planner) return "planOnly";
  // 리서처 단독일 때만 research — 검증자와 섞인 조합은 validateAgents가 거절한다.
  if (roster.researcher && roster.verifierIds.length === 0) return "research";
  return "verifyOnly";
}

// Sanitize a PLANNER-recommended team (호재의 ```team 블록) into an applyable
// selection: unknown keys dropped, 호재 자신은 항상 포함(에스컬레이션 유지),
// 개발자가 한 명도 안 남으면 적용 불가(null) — 계획 기반 run은 구현이 있어야 한다.
// 안전선: 자동 배치가 "검증자 0명 → 리뷰 없는 커밋"으로 흐르지 않도록, 품질(주호)과
// 빌드 게이트(성호)는 추천과 무관하게 항상 포함한다. 검증을 정말 빼는 것은 사용자가
// 직접 선택 모드에서 의식적으로 고를 때만 가능하다.
export function applyableTeam(keys: string[]): string[] | null {
  // 리서치 좌석은 개발 run의 팀이 아니다 — 추천에 섞여 와도 버린다.
  const known = [...new Set(keys.map(String).filter((k) => byKey.get(k) && byKey.get(k)!.role !== "research"))];
  if (!known.includes("plan:hojae")) known.unshift("plan:hojae");
  for (const required of ["verify:juho", "verify:seongho"]) {
    if (!known.includes(required)) known.push(required);
  }
  return rosterOf(known).builderIds.length > 0 ? known : null;
}

// A dev reference from the planner ("build:taekyung" seat key, or a bare person
// id) → build-seat person id, or null when it isn't a selectable developer.
export function devAgentIdOf(ref: string): string | null {
  const seat = byKey.get(ref);
  if (seat?.role === "build") return seat.agentId;
  const byPerson = SEATS.find((s) => s.role === "build" && s.agentId === ref);
  return byPerson?.agentId ?? null;
}

// "기획 호재 / 개발 태경·민재 / 검증 주호·성호" — 로그·채팅용 한 줄 팀 요약.
export function describeTeam(keys: string[]): string {
  const part = (role: RosterRole, title: string) => {
    const names = SEATS.filter((s) => s.role === role && keys.includes(s.key)).map((s) => s.name);
    return names.length ? `${title} ${names.join("·")}` : null;
  };
  return [part("plan", "기획"), part("build", "개발"), part("verify", "검증"), part("research", "리서치")]
    .filter(Boolean)
    .join(" / ");
}

// Validate a user-supplied selection STRICTLY — the API boundary rejects what
// this flags, so unknown keys never reach the DB and an empty list never
// silently means "전원". Returns a Korean error message, or null when runnable:
//   - 개발 포함: 기획/검증은 자유 (기획 없음 = 바로 구현, 검증 없음 = LLM 리뷰
//     생략 — 단 빌드 게이트는 모든 build run에 항상 실행된다. pipeline/shared.ts)
//   - 검증만: 프로젝트 현재 상태 감사 (기획/개발 없음)
//   - 기획만: 계획서만 작성하고 종료
export function validateAgents(keys: string[]): string | null {
  if (keys.length === 0) return "참여할 에이전트를 한 명 이상 선택하세요.";
  const unknown = keys.filter((k) => !byKey.has(k));
  if (unknown.length > 0) return `알 수 없는 에이전트입니다: ${unknown.join(", ")}`;
  const r = rosterOf(keys);
  // 리서치는 단독 run — 코드 파이프라인(기획/개발/검증)과 섞을 수 없다.
  if (r.researcher && keys.length > 1) {
    return "리서치는 상현 단독으로만 실행할 수 있습니다 — 다른 에이전트와 함께 선택할 수 없어요.";
  }
  // planOnly는 기획서만 쓰고 끝난다 — 검증자가 같이 있으면 그 검증은 영영 안
  // 돌므로 실행 불가능한 조합으로 거절한다.
  if (runModeOf(r) === "planOnly" && r.verifierIds.length > 0) {
    return "개발 에이전트 없이 기획과 검증을 함께 선택할 수 없습니다 — 개발자를 추가하거나 하나만 선택하세요.";
  }
  return null;
}
