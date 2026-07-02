// ── The cast (domain data + mapping — no rendering) ────────────────────────
// Each pipeline role is played by a named pixel character. Two developers and
// two verifiers share their role; which one shows up for a given step is picked
// deterministically (by attempt / id hash) so identities stay stable on reload.
//
//   기획 (plan)   = Opus   → 호재
//   개발 (build)  = Sonnet → 태경 · 민재
//   검증 (verify) = codex  → 주호 · 동환
//
// This module is pure data + lookups so both server and client components can
// use it. How a character is DRAWN lives in agents.tsx (SVG components).

import type { Step } from "./types";

export type Role = "plan" | "build" | "verify" | "system";

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
    roleLabel: "개발",
    engineLabel: "Sonnet",
    blurb: "설계대로 코드를 짜요",
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
    roleLabel: "개발",
    engineLabel: "Sonnet",
    blurb: "까다로운 부분을 맡아 구현해요",
    hair: "#3a2f4a",
    shirt: "#3fd0c9",
    accent: "#238f89",
    feature: "spiky",
    laptop: MACBOOK_SPACEGRAY,
  },
  {
    id: "juho",
    name: "주호",
    role: "verify",
    roleLabel: "검증",
    engineLabel: "codex",
    blurb: "코드가 요구사항을 만족하는지 검사해요",
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
    roleLabel: "검증",
    engineLabel: "codex",
    blurb: "빠뜨린 결함이 없는지 다시 살펴요",
    hair: "#2b2b33",
    shirt: "#ff9f6b",
    accent: "#c96a35",
    feature: "mustache",
    laptop: MACBOOK_SPACEGRAY,
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
  system: "커밋",
};

export const ROLE_COLOR: Record<Role, string> = {
  plan: "#5b9dff",
  build: "#57d99a",
  verify: "#b98bff",
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
    default:
      return "system";
  }
}

function roleForModel(model: string | null | undefined, phase: string | null | undefined): Role {
  const p = (phase ?? "").toLowerCase();
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

export function membersOf(role: Role): Agent[] {
  return CAST.filter((a) => a.role === role);
}

// Steps: pick teammate by attempt (a retry hands off to the other person),
// falling back to an id hash so it stays stable.
export function agentForStep(step: Step): Agent {
  const role = roleForKind(step.kind);
  if (role === "system") return SYSTEM_AGENT;
  const members = membersOf(role);
  if (members.length === 1) return members[0];
  const idx =
    (step.attempt && step.attempt > 0 ? step.attempt - 1 : hashStr(step.id)) % members.length;
  return members[idx];
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

// Team-chat turn → character. role+attempt pick the SAME teammate the step
// avatars use (attempt parity), so 태경/민재·주호/동환 stay consistent.
export function agentForChat(msg: { role: string; attempt?: number }): Agent {
  if (msg.role === "user") return USER_AGENT;
  if (msg.role === "plan") return membersOf("plan")[0] ?? SYSTEM_AGENT;
  if (msg.role === "build" || msg.role === "verify") {
    const members = membersOf(msg.role);
    if (members.length === 0) return SYSTEM_AGENT;
    const a = msg.attempt && msg.attempt > 0 ? msg.attempt - 1 : 0;
    return members[a % members.length];
  }
  return SYSTEM_AGENT;
}
