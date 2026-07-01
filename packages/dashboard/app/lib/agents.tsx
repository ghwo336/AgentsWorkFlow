"use client";

// ── The cast ────────────────────────────────────────────────────────────────
// Each pipeline role is played by a named pixel character. Two developers and
// two verifiers share their role; which one shows up for a given step is picked
// deterministically (by attempt / id hash) so identities stay stable on reload.
//
//   기획 (plan)   = Opus   → 호재
//   개발 (build)  = Sonnet → 태경 · 민재
//   검증 (verify) = codex  → 주호 · 동환

import type { Step } from "./types";

export type Role = "plan" | "build" | "verify" | "system";

export type Feature = "glasses" | "headset" | "spiky" | "mustache" | "none";

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
};

const SKIN = "#f2c9a0";
const EYE = "#26283a";

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

function membersOf(role: Role): Agent[] {
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

// ── Pixel avatar ────────────────────────────────────────────────────────────
// A chunky little office worker drawn from integer rects (crisp, no AA) so it
// reads as pixel art. Collar + tie give the corporate vibe; per-character
// hair / shirt colors + one feature (glasses / headset / spiky / mustache)
// keep everyone distinct.
export function PixelAvatar({ agent, size = 40 }: { agent: Agent; size?: number }) {
  const px = (n: number) => n; // 16-unit viewBox
  const R = (x: number, y: number, w: number, h: number, fill: string, opacity?: number) => (
    <rect key={`${x}-${y}-${w}-${h}-${fill}`} x={px(x)} y={px(y)} width={w} height={h} fill={fill} opacity={opacity} />
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated", display: "block", flex: "0 0 auto" }}
      role="img"
      aria-label={`${agent.name} 픽셀 아바타`}
    >
      {/* body / shoulders */}
      {R(2, 12, 12, 4, agent.shirt)}
      {R(2, 12, 12, 1, agent.shirt)}
      {/* collar */}
      {R(6, 12, 4, 1, "#ffffff")}
      {/* neck */}
      {R(7, 11, 2, 1, SKIN)}
      {/* tie */}
      {R(7, 12, 2, 1, agent.accent)}
      {R(7, 13, 2, 3, agent.accent)}
      {/* head */}
      {R(4, 3, 8, 8, SKIN)}
      {/* hair crown + sides */}
      {R(3, 2, 10, 3, agent.hair)}
      {R(3, 5, 1, 2, agent.hair)}
      {R(12, 5, 1, 2, agent.hair)}
      {agent.feature === "spiky" && (
        <>
          {R(4, 1, 1, 1, agent.hair)}
          {R(7, 1, 2, 1, agent.hair)}
          {R(11, 1, 1, 1, agent.hair)}
        </>
      )}
      {/* eyes */}
      {R(6, 7, 1, 2, EYE)}
      {R(9, 7, 1, 2, EYE)}
      {/* blush */}
      {R(5, 9, 1, 1, "#ff9db0", 0.85)}
      {R(10, 9, 1, 1, "#ff9db0", 0.85)}
      {/* mouth */}
      {agent.feature === "mustache" ? R(6, 9, 4, 1, agent.hair) : R(7, 10, 2, 1, "#c56a54")}
      {/* glasses */}
      {agent.feature === "glasses" && (
        <>
          <rect x={5} y={6} width={3} height={3} fill="none" stroke={agent.accent} strokeWidth={1} />
          <rect x={8} y={6} width={3} height={3} fill="none" stroke={agent.accent} strokeWidth={1} />
          {R(8, 7, 1, 1, agent.accent)}
        </>
      )}
      {/* headset */}
      {agent.feature === "headset" && (
        <>
          {R(3, 2, 10, 1, agent.accent)}
          {R(3, 6, 1, 3, agent.accent)}
          {R(12, 6, 1, 3, agent.accent)}
          {R(3, 9, 2, 1, agent.accent)}
          {R(5, 9, 1, 1, agent.accent)}
        </>
      )}
    </svg>
  );
}

// ── Office props (pixel scenery) ────────────────────────────────────────────
const pxRect = (x: number, y: number, w: number, h: number, fill: string, opacity?: number) => (
  <rect key={`${x}-${y}-${w}-${h}-${fill}`} x={x} y={y} width={w} height={h} fill={fill} opacity={opacity} />
);

// A framed window looking out on a daytime sky — the back-wall centerpiece.
export function OfficeWindow({ w = 40 }: { w?: number }) {
  return (
    <svg width={w} height={(w * 20) / 28} viewBox="0 0 28 20" shapeRendering="crispEdges" style={{ display: "block" }}>
      {pxRect(0, 0, 28, 20, "#6b5a45")}
      {pxRect(2, 2, 24, 16, "#7fb2e6")}
      {pxRect(2, 2, 24, 6, "#a9d1f2")}
      {/* sun + clouds */}
      {pxRect(20, 4, 3, 3, "#ffe08a")}
      {pxRect(5, 10, 5, 2, "#eaf4ff")}
      {pxRect(7, 8, 4, 2, "#eaf4ff")}
      {pxRect(15, 13, 6, 2, "#eaf4ff")}
      {/* mullions */}
      {pxRect(13, 2, 2, 16, "#6b5a45")}
      {pxRect(2, 9, 24, 2, "#6b5a45")}
    </svg>
  );
}

// A little potted desk plant.
export function DeskPlant({ h = 26 }: { h?: number }) {
  return (
    <svg width={(h * 10) / 16} height={h} viewBox="0 0 10 16" shapeRendering="crispEdges" style={{ display: "block" }}>
      {/* leaves */}
      {pxRect(4, 0, 2, 6, "#57d99a")}
      {pxRect(1, 3, 2, 4, "#3fb87f")}
      {pxRect(7, 3, 2, 4, "#3fb87f")}
      {pxRect(2, 1, 2, 3, "#6ee6ac")}
      {pxRect(6, 1, 2, 3, "#6ee6ac")}
      {/* pot */}
      {pxRect(2, 9, 6, 2, "#d98b5b")}
      {pxRect(2, 11, 6, 5, "#c07548")}
      {pxRect(2, 9, 6, 1, "#e6a878")}
    </svg>
  );
}

// A wall clock.
export function WallClock({ s = 20 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" shapeRendering="crispEdges" style={{ display: "block" }}>
      {pxRect(1, 1, 10, 10, "#e8ebff")}
      {pxRect(2, 2, 8, 8, "#ffffff")}
      {pxRect(5, 3, 1, 3, "#26283a")}
      {pxRect(6, 5, 2, 1, "#26283a")}
      {/* frame */}
      {pxRect(1, 0, 10, 1, "#4b5573")}
      {pxRect(1, 11, 10, 1, "#4b5573")}
      {pxRect(0, 1, 1, 10, "#4b5573")}
      {pxRect(11, 1, 1, 10, "#4b5573")}
    </svg>
  );
}

// A desk with a monitor (screen tinted to the person's role color), keyboard
// and coffee mug — the character sits behind it.
export function Workstation({ screen = "#5b9dff", w = 60 }: { screen?: string; w?: number }) {
  return (
    <svg width={w} height={(w * 12) / 24} viewBox="0 0 24 12" shapeRendering="crispEdges" style={{ display: "block" }}>
      {/* monitor */}
      {pxRect(6, 0, 12, 6, "#2b2f40")}
      {pxRect(7, 1, 10, 4, screen)}
      {pxRect(8, 2, 6, 1, "#ffffff", 0.75)}
      {pxRect(8, 3, 4, 1, "#ffffff", 0.5)}
      {pxRect(11, 6, 2, 1, "#2b2f40")}
      {/* coffee mug */}
      {pxRect(2, 3, 3, 3, "#d98b5b")}
      {pxRect(5, 4, 1, 1, "#d98b5b")}
      {pxRect(2, 2, 3, 1, "#eaf4ff", 0.6)}
      {/* desk top + front */}
      {pxRect(0, 7, 24, 2, "#7d6a52")}
      {pxRect(0, 7, 24, 1, "#8f7a5f")}
      {pxRect(0, 9, 24, 3, "#574837")}
      {/* keyboard */}
      {pxRect(9, 6, 6, 1, "#3a3f52")}
    </svg>
  );
}

// The brand mascot — a friendly little agent-bot. Antenna light + a screen face
// with a cyan smile, blush, and green/purple side lights nodding to the roles.
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated", display: "block", flex: "0 0 auto" }}
      role="img"
      aria-label="Agent Loop 마스코트"
    >
      {/* antenna */}
      {pxRect(6, 0, 4, 1, "#ffe08a")}
      {pxRect(7, 1, 2, 2, "#8b93b8")}
      {/* head body */}
      {pxRect(3, 3, 10, 1, "#7fb0ff")}
      {pxRect(2, 4, 12, 10, "#5b9dff")}
      {pxRect(2, 13, 12, 1, "#2b4f8f")}
      {/* side role lights */}
      {pxRect(1, 6, 1, 3, "#57d99a")}
      {pxRect(14, 6, 1, 3, "#b98bff")}
      {/* face screen */}
      {pxRect(3, 5, 10, 6, "#12141c")}
      {/* eyes + smile */}
      {pxRect(5, 6, 2, 2, "#7fe0ff")}
      {pxRect(9, 6, 2, 2, "#7fe0ff")}
      {pxRect(6, 9, 4, 1, "#7fe0ff")}
      {/* blush */}
      {pxRect(3, 8, 1, 1, "#ff9db0")}
      {pxRect(12, 8, 1, 1, "#ff9db0")}
      {/* feet */}
      {pxRect(4, 14, 3, 2, "#2b4f8f")}
      {pxRect(9, 14, 3, 2, "#2b4f8f")}
    </svg>
  );
}

// ── Reusable bits ───────────────────────────────────────────────────────────
export function AgentChip({ agent, size = 26 }: { agent: Agent; size?: number }) {
  return (
    <span className="agent-chip" title={`${agent.name} · ${agent.roleLabel} (${agent.engineLabel})`}>
      <PixelAvatar agent={agent} size={size} />
      <span className="agent-chip-name" style={{ color: ROLE_COLOR[agent.role] }}>
        {agent.name}
      </span>
    </span>
  );
}

// Team roster — styled as our little office: a back wall with a window, clock
// and plant, then desk pods grouped by role, each teammate sitting at a
// workstation whose monitor glows in their role color.
export function TeamRoster() {
  const groups: { role: Role; members: Agent[] }[] = [
    { role: "plan", members: membersOf("plan") },
    { role: "build", members: membersOf("build") },
    { role: "verify", members: membersOf("verify") },
  ];
  return (
    <div className="panel office">
      <div className="office-wall">
        <b className="pixel">🏢 우리 사무실</b>
        <div className="office-deco">
          <WallClock s={18} />
          <OfficeWindow w={40} />
          <DeskPlant h={24} />
        </div>
      </div>
      <div className="muted small" style={{ margin: "10px 0" }}>
        기획 → 개발 → 검증 → 커밋
      </div>
      <div className="office-floor">
        {groups.map((g) => (
          <div key={g.role} className="desk-pod" style={{ borderLeftColor: ROLE_COLOR[g.role] }}>
            <div className="roster-role" style={{ color: ROLE_COLOR[g.role] }}>
              {ROLE_LABEL[g.role]}
            </div>
            <div className="roster-members">
              {g.members.map((a) => (
                <div key={a.id} className="desk-seat" title={a.blurb}>
                  <PixelAvatar agent={a} size={40} />
                  <div className="desk-station">
                    <Workstation screen={a.shirt} w={62} />
                  </div>
                  <div className="roster-name pixel">{a.name}</div>
                  <div className="roster-engine muted small">{a.engineLabel}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
