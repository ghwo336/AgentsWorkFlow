// ── The cast (domain data + mapping — no rendering) ────────────────────────
// Each pipeline role is played by a named pixel character. Two developers and
// two verifiers share their role; which one shows up for a given step is picked
// deterministically (by attempt / id hash) so identities stay stable on reload.
//
//   기획 (plan)   = Opus       → 호재
//   개발 (build)  = Sonnet     → 태경(프론트엔드) · 민재(백엔드) · 주희(iOS)
//                                · 성민(Android) · 연한(크로스플랫폼 RN)
//   코드 품질 (verify) = codex(품질)  → 주호 (SOLID 등 공학 원칙)
//   보안 검증 (verify) = codex(보안)  → 동환 (보안 전담 감사)
//   통합 검증 (verify) = Claude(통합) → 유준 (런타임·배선 동작)
//   QA       (verify) = 빌드(빌드)   → 성호 (빌드/타입체크 실제 실행)
//   리서치 (research) = Opus        → 상현 (웹 조사 → 보고서)
//
// This module is pure data + lookups so both server and client components can
// use it. How a character is DRAWN lives in agents.tsx (SVG components).

import type { Step } from "./types";

// Selection vocabulary shared with the orchestrator (seat keys, run roster
// parsing/validation) — re-exported so client code keeps one import surface.
// A SEAT is role×person ("build:juho"): 주호 holds a 개발 seat and a 검증 seat.
export {
  ALL_SEAT_KEYS,
  parseAgents,
  RESEARCH_PROJECT,
  rosterOf,
  runModeOf,
  seatsOf,
  SEATS,
  validateAgents,
  type RosterRole,
  type RosterSeat,
  type RunMode,
} from "@agent-loop/shared/roster";

export type Role = "plan" | "build" | "verify" | "research" | "system";

export type Feature = "glasses" | "headset" | "spiky" | "mustache" | "none";

// Each teammate's laptop — shown (typing + on fire) while they work. brand sets
// the silhouette; lid/logo set the color (MacBook silver vs space gray). Everyone
// is on a MacBook; only the finish differs.
export type Laptop = { brand: "macbook" | "galaxybook"; lid: string; logo: string };

export type Agent = {
  id: string;
  name: string; // 호재
  role: Role;
  roleLabel: string; // 기획
  engineLabel: string; // Opus 4.8
  blurb: string; // one-liner personality
  // palette
  hair: string;
  shirt: string;
  accent: string; // tie + feature color
  feature: Feature;
  laptop: Laptop;
};

// Shared laptop palettes.
const MACBOOK_SILVER: Laptop = { brand: "macbook", lid: "#c9ccd2", logo: "#eef0f4" };
const MACBOOK_SPACEGRAY: Laptop = { brand: "macbook", lid: "#52555c", logo: "#868a93" };

export const CAST: Agent[] = [
  {
    id: "hojae",
    name: "호재",
    role: "plan",
    roleLabel: "기획",
    engineLabel: "Opus",
    blurb: "요구사항을 뜯어보고 계획을 세워요",
    hair: "#6b4a2b",
    shirt: "#5b9dff",
    accent: "#2b4f8f",
    feature: "glasses",
    laptop: MACBOOK_SILVER,
  },
  {
    id: "taekyung",
    name: "태경",
    role: "build",
    roleLabel: "프론트엔드",
    engineLabel: "Sonnet",
    blurb: "웹 화면(UI)을 만들어요 — 프론트엔드 전문",
    hair: "#2b2b33",
    shirt: "#57d99a",
    accent: "#2f8f63",
    feature: "headset",
    laptop: MACBOOK_SILVER,
  },
  {
    id: "minjae",
    name: "민재",
    role: "build",
    roleLabel: "백엔드",
    engineLabel: "Sonnet",
    blurb: "서버와 데이터(API/DB)를 맡아요 — 백엔드 전문",
    hair: "#3a2f4a",
    shirt: "#3fd0c9",
    accent: "#238f89",
    feature: "spiky",
    laptop: MACBOOK_SPACEGRAY,
  },
  {
    id: "juhee",
    name: "주희",
    role: "build",
    roleLabel: "iOS",
    engineLabel: "Sonnet",
    blurb: "Swift로 아이폰 앱을 만들어요 — iOS 전문",
    hair: "#5a3550",
    shirt: "#ff8fb1",
    accent: "#c2557f",
    feature: "none",
    laptop: MACBOOK_SILVER,
  },
  {
    id: "seongmin",
    name: "성민",
    role: "build",
    roleLabel: "Android",
    engineLabel: "Sonnet",
    blurb: "Kotlin으로 안드로이드 앱을 만들어요 — Android 전문",
    hair: "#2b2b33",
    shirt: "#3ddc84",
    accent: "#1f8f4d",
    feature: "glasses",
    laptop: MACBOOK_SPACEGRAY,
  },
  {
    id: "yeonhan",
    name: "연한",
    role: "build",
    roleLabel: "크로스플랫폼",
    engineLabel: "Sonnet",
    blurb: "React Native로 iOS·Android를 한 번에 만들어요",
    hair: "#23303f",
    shirt: "#61dafb",
    accent: "#2a91b8",
    feature: "headset",
    laptop: MACBOOK_SILVER,
  },
  {
    id: "juho",
    name: "주호",
    role: "verify",
    roleLabel: "코드 품질",
    engineLabel: "codex",
    blurb: "SOLID·중복·설계 원칙을 지켰는지 봐요",
    hair: "#4a3b2b",
    shirt: "#b98bff",
    accent: "#7a4fd0",
    feature: "glasses",
    laptop: MACBOOK_SILVER,
  },
  {
    id: "donghwan",
    name: "동환",
    role: "verify",
    roleLabel: "보안 검증",
    engineLabel: "codex",
    blurb: "취약점이 없는지 보안 감사를 해요",
    hair: "#2b2b33",
    shirt: "#ff9f6b",
    accent: "#c96a35",
    feature: "mustache",
    laptop: MACBOOK_SPACEGRAY,
  },
  {
    id: "yujun",
    name: "유준",
    role: "verify",
    roleLabel: "통합 검증",
    engineLabel: "Sonnet",
    blurb: "실제로 돌아갈지 배선을 따라가며 살펴요",
    hair: "#23303f",
    shirt: "#8fb7ff",
    accent: "#4a6fb8",
    feature: "spiky",
    laptop: MACBOOK_SILVER,
  },
  {
    id: "seongho",
    name: "성호",
    role: "verify",
    roleLabel: "QA",
    engineLabel: "빌드",
    blurb: "직접 빌드를 돌려서 깨지는지 확인해요",
    hair: "#4a3b2b",
    shirt: "#ffd166",
    accent: "#b8860b",
    feature: "headset",
    laptop: MACBOOK_SPACEGRAY,
  },
  {
    id: "sanghyun",
    name: "상현",
    role: "research",
    roleLabel: "리서치",
    engineLabel: "Opus",
    blurb: "웹을 뒤져 근거 있는 조사 보고서를 써요 — 리서치 전문",
    hair: "#2f2a26",
    shirt: "#ffb454",
    accent: "#c77f22",
    feature: "glasses",
    laptop: MACBOOK_SILVER,
  },
];

export const SYSTEM_AGENT: Agent = {
  id: "system",
  name: "시스템",
  role: "system",
  roleLabel: "커밋",
  engineLabel: "system",
  blurb: "결과를 저장해요",
  hair: "#4b5573",
  shirt: "#8b93b8",
  accent: "#5a6488",
  feature: "none",
  laptop: MACBOOK_SPACEGRAY,
};

export const ROLE_LABEL: Record<Role, string> = {
  plan: "기획",
  build: "개발",
  verify: "검증",
  research: "리서치",
  system: "커밋",
};

export const ROLE_COLOR: Record<Role, string> = {
  plan: "#5b9dff",
  build: "#57d99a",
  verify: "#b98bff",
  research: "#ffb454",
  system: "#8b93b8",
};

const byId = Object.fromEntries(CAST.map((a) => [a.id, a]));
export function agentById(id: string): Agent {
  return byId[id] ?? SYSTEM_AGENT;
}

// ── Mapping: pipeline artifacts → character ─────────────────────────────────
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function roleForKind(kind: string): Role {
  switch (kind) {
    case "plan":
      return "plan";
    case "build":
      return "build";
    case "verify":
    case "review":
    case "test":
      return "verify";
    case "research":
      return "research";
    default:
      return "system";
  }
}

function roleForModel(model: string | null | undefined, phase: string | null | undefined): Role {
  const p = (phase ?? "").toLowerCase();
  if (p.includes("research")) return "research";
  if (p.includes("plan")) return "plan";
  if (p.includes("build")) return "build";
  if (p.includes("verify") || p.includes("review") || p.includes("test")) return "verify";
  if (p.includes("commit")) return "system";
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus")) return "plan";
  if (m.includes("sonnet")) return "build";
  if (m.includes("codex")) return "verify";
  return "system";
}

// CAST members of a visual role — used for LEGACY fallbacks (pre-stamp steps'
// attempt rotation). The current selectable team lives in SEATS (seatsOf).
export function membersOf(role: Role): Agent[] {
  return CAST.filter((a) => a.role === role);
}

// ── Verify seats map by REVIEWER IDENTITY ───────────────────────────────────
// The pipeline stamps each verify span/log/chat with the reviewer's name key
// (품질/보안/통합/빌드). Two codex reviewers share an engine, so identity — not
// engine — decides the seat. Legacy rows (engine-only: codex/claude/system)
// fall back to the old attempt-rotation so history still renders.
const VERIFY_SEAT: Record<string, string> = {
  "품질": "juho",
  "보안": "donghwan",
  "통합": "yujun",
  "빌드": "seongho",
  tests: "seongho",
};

function verifyAgent(key: string | null | undefined, pick: number): Agent {
  const k = (key ?? "").trim();
  const seat = VERIFY_SEAT[k];
  if (seat) return agentById(seat);
  const low = k.toLowerCase();
  if (low.includes("claude")) return agentById("yujun");
  if (low === "system" || low.includes("build") || low.includes("test")) return agentById("seongho");
  // legacy codex rows: keep the old 주호/동환 rotation by attempt
  const legacy = ["juho", "donghwan"];
  return agentById(legacy[pick % legacy.length]);
}

// Steps: the pipeline stamps new spans with their owner's roster id (step.agent)
// — trust it directly. Legacy spans fall back to the old heuristics: teammate by
// attempt (a retry hands off to the other person), then an id hash.
export function agentForStep(step: Step): Agent {
  if (step.agent && byId[step.agent]) return byId[step.agent];
  const role = roleForKind(step.kind);
  if (role === "system") return SYSTEM_AGENT;
  const pick = step.attempt && step.attempt > 0 ? step.attempt - 1 : hashStr(step.id);
  if (role === "verify") {
    // New spans carry the reviewer name in the label ("리뷰: 품질"); older ones
    // only have an engine — verifyAgent handles both.
    const named = step.label.match(/^(?:리뷰|테스트):\s*(.+)$/);
    return verifyAgent(named?.[1] ?? step.engine, pick);
  }
  const members = membersOf(role);
  if (members.length === 1) return members[0];
  return members[pick % members.length];
}

// Events: keep one stable face per (role, model) so a phase's log lines don't
// flicker between teammates. Accepts any event-ish row (client view model or a
// Prisma row), reading only id / model / phase.
export function agentForEvent(ev: {
  id: string;
  model?: string | null;
  phase?: string | null;
}): Agent {
  const role = roleForModel(ev.model, ev.phase);
  if (role === "system") return SYSTEM_AGENT;
  // Verify log lines carry the reviewer engine in `model` (see pipeline review()).
  if (role === "verify") return verifyAgent(ev.model, hashStr(`${role}:${ev.model ?? ""}`));
  const members = membersOf(role);
  if (members.length === 1) return members[0];
  return members[hashStr(`${role}:${ev.model ?? ev.phase ?? ""}`) % members.length];
}

// The user (team leader) as a chat participant — the human at the needs_input
// gate. Not part of the CAST; styled as its own character.
export const USER_AGENT: Agent = {
  id: "leader",
  name: "리더(나)",
  role: "system",
  roleLabel: "팀 리더",
  engineLabel: "사용자",
  blurb: "최종 결정을 내려요",
  hair: "#3a2f2a",
  shirt: "#e6b566",
  accent: "#b07d33",
  feature: "none",
  laptop: SYSTEM_AGENT.laptop,
};

// Team-chat turn → character. New turns carry the speaker's roster id (agent)
// — trust it. Legacy turns: role+attempt pick the SAME teammate the step
// avatars use (attempt parity); verify turns use their engine (codex→주호·동환,
// claude→유준, system→성호) so the chat matches the step nodes.
export function agentForChat(msg: {
  role: string;
  attempt?: number;
  engine?: string | null;
  agent?: string | null;
}): Agent {
  if (msg.role === "user") return USER_AGENT;
  if (msg.agent && byId[msg.agent]) return byId[msg.agent];
  if (msg.role === "plan") return membersOf("plan")[0] ?? SYSTEM_AGENT;
  if (msg.role === "research") return membersOf("research")[0] ?? SYSTEM_AGENT;
  const a = msg.attempt && msg.attempt > 0 ? msg.attempt - 1 : 0;
  if (msg.role === "verify") return verifyAgent(msg.engine, a);
  if (msg.role === "build") {
    const members = membersOf("build");
    if (members.length === 0) return SYSTEM_AGENT;
    return members[a % members.length];
  }
  return SYSTEM_AGENT;
}
