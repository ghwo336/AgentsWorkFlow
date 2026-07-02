// NOTE: intentionally NOT "use client". Everything here is pure (SVG render
// helpers + deterministic data/lookups, no hooks/events/browser APIs), so this
// is a SHARED module usable from both server and client components. Marking it
// "use client" made server components (e.g. /runs/[id]) crash when they call
// agentById()/agentForEvent() — you can't invoke a client-module function from
// the server, only render its components.
//
// WHO the characters are (data + step/event → character mapping) lives in
// cast.ts; this module owns HOW they are drawn (pixel-art SVG components).
// cast.ts is re-exported so consumers keep one import surface.

import { membersOf, ROLE_COLOR, ROLE_LABEL, type Agent, type Laptop, type Role } from "./cast";

export * from "./cast";

const SKIN = "#f2c9a0";
const EYE = "#26283a";

// ── Pixel avatar ────────────────────────────────────────────────────────────
// A chunky little office worker drawn from integer rects (crisp, no AA) so it
// reads as pixel art. Collar + tie give the corporate vibe; per-character
// hair / shirt colors + one feature (glasses / headset / spiky / mustache)
// keep everyone distinct.
export function PixelAvatar({
  agent,
  size = 40,
  active = false,
}: {
  agent: Agent;
  size?: number;
  active?: boolean;
}) {
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
      className={`pixel-avatar pixel-avatar-${agent.role}${active ? " is-active" : ""}`}
      style={{ imageRendering: "pixelated", display: "block", flex: "0 0 auto" }}
      role="img"
      aria-label={`${agent.name} 픽셀 아바타`}
    >
      {/* Fire shell BEHIND the body — flames wrap all the way around the
          silhouette (열정을 태우는 느낌) while they're actively working. */}
      {active && (
        <g className="pixel-avatar-fire pixel-avatar-fire-shell">
          {/* outer red flames hugging the outline, top → sides → base */}
          {R(4, 0, 1, 3, "#ff5a2c")}
          {R(7, 0, 2, 2, "#ff5a2c")}
          {R(11, 0, 1, 3, "#ff5a2c")}
          {R(0, 9, 1, 7, "#ff5a2c")}
          {R(1, 6, 1, 10, "#ff5a2c")}
          {R(15, 9, 1, 7, "#ff5a2c")}
          {R(14, 6, 1, 10, "#ff5a2c")}
          {R(2, 4, 1, 3, "#ff5a2c")}
          {R(13, 4, 1, 3, "#ff5a2c")}
          {R(1, 15, 14, 1, "#ff5a2c")}
          {/* orange mid-flames, inset licks */}
          {R(1, 4, 1, 3, "#ff9d2e")}
          {R(14, 4, 1, 3, "#ff9d2e")}
          {R(0, 12, 1, 4, "#ff9d2e")}
          {R(15, 12, 1, 4, "#ff9d2e")}
          {R(7, 1, 2, 1, "#ff9d2e")}
          {/* hottest yellow tips */}
          {R(7, 0, 1, 1, "#ffe15a")}
          {R(1, 5, 1, 1, "#ffe15a")}
          {R(14, 5, 1, 1, "#ffe15a")}
        </g>
      )}
      <g className="pixel-avatar-body">
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
        <rect className="pixel-avatar-eye pixel-avatar-eye-left" x={6} y={7} width={1} height={2} fill={EYE} />
        <rect className="pixel-avatar-eye pixel-avatar-eye-right" x={9} y={7} width={1} height={2} fill={EYE} />
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
      </g>

      {/* Their laptop (open, in front of the torso), shown on the larger avatars
          (roster/summary) as an identity prop and whenever they're actively
          working. The character is engulfed in flames while working — 열일 중 🔥. */}
      {(active || size >= 28) && (
        <g className="pixel-avatar-laptop">
          {R(3, 15, 10, 1, "#0e0f14")} {/* base shadow */}
          {R(4, 12, 8, 3, agent.laptop.lid)} {/* screen lid (back) */}
          {R(4, 12, 8, 1, "#000000", 0.22)} {/* top bezel shade */}
          {agent.laptop.brand === "macbook"
            ? R(7, 13, 2, 1, agent.laptop.logo) /* glowing apple logo */
            : R(4, 14, 8, 1, agent.laptop.logo) /* galaxy hinge accent */}
        </g>
      )}
      {/* Flame tongues IN FRONT — licking up over the body's edges so the
          character reads as engulfed, not just standing near a fire. */}
      {active && (
        <g className="pixel-avatar-fire pixel-avatar-fire-front">
          {R(2, 12, 1, 4, "#ff9d2e", 0.8)}
          {R(13, 12, 1, 4, "#ff9d2e", 0.8)}
          {R(3, 10, 1, 3, "#ff5a2c", 0.6)}
          {R(12, 10, 1, 3, "#ff5a2c", 0.6)}
          {R(2, 8, 1, 2, "#ffe15a", 0.6)}
          {R(13, 8, 1, 2, "#ffe15a", 0.6)}
        </g>
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

// A desk with the character's own OPEN LAPTOP (MacBook / Galaxy Book, in their
// color) instead of a generic monitor — viewed from behind the lid so the brand
// logo faces us. Used in the office roster.
export function DeskLaptop({ laptop, w = 62 }: { laptop: Laptop; w?: number }) {
  const mac = laptop.brand === "macbook";
  return (
    <svg width={w} height={(w * 12) / 24} viewBox="0 0 24 12" shapeRendering="crispEdges" style={{ display: "block" }}>
      {/* open lid (back), standing on the desk */}
      {pxRect(7, 0, 11, 6, laptop.lid)}
      {pxRect(7, 0, 11, 1, "#000000", 0.28)} {/* top bezel */}
      {pxRect(7, 0, 1, 6, "#ffffff", 0.1)} {/* left edge highlight */}
      {pxRect(17, 0, 1, 6, "#000000", 0.18)} {/* right edge shade */}
      {mac ? (
        <>
          {pxRect(11, 2, 3, 2, laptop.logo)} {/* apple logo */}
          {pxRect(12, 2, 1, 1, "#ffffff", 0.7)} {/* glint */}
        </>
      ) : (
        <>
          {pxRect(9, 4, 7, 1, laptop.logo)} {/* galaxy brand bar */}
          {pxRect(11, 2, 3, 1, laptop.logo)}
        </>
      )}
      {/* hinge / keyboard base along the desk edge */}
      {pxRect(6, 6, 13, 1, "#20232c")}
      {/* coffee mug */}
      {pxRect(2, 3, 3, 3, "#d98b5b")}
      {pxRect(5, 4, 1, 1, "#d98b5b")}
      {pxRect(2, 2, 3, 1, "#eaf4ff", 0.6)}
      {/* desk top + front */}
      {pxRect(0, 7, 24, 2, "#7d6a52")}
      {pxRect(0, 7, 24, 1, "#8f7a5f")}
      {pxRect(0, 9, 24, 3, "#574837")}
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
export function TeamRoster({ activeIds }: { activeIds?: Set<string> } = {}) {
  // Three coarse pods (기획/개발/검증) so the office stays compact — per-person
  // 직책 (코드 품질/보안 검증/통합 검증/QA) is shown on each card instead of
  // splitting the verify family into its own pods (which stacked too tall).
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
              {g.members.map((a) => {
                const working = activeIds?.has(a.id) ?? false;
                return (
                <div
                  key={a.id}
                  className={`desk-seat${working ? " is-working" : ""}`}
                  title={working ? `${a.name} — 열일 중 🔥` : `${a.blurb} (${a.engineLabel})`}
                >
                  <PixelAvatar agent={a} size={40} active={working} />
                  <div className="desk-station">
                    <DeskLaptop laptop={a.laptop} w={62} />
                  </div>
                  <div className="roster-name pixel">{a.name}</div>
                  {/* 카드에는 그 사람의 직책. 파드 제목과 같은 직책(기획/개발)이면
                      대신 엔진을 보여줘 정보가 중복되지 않게. 엔진은 툴팁에도 있음. */}
                  <div className="roster-engine muted small">
                    {a.roleLabel === ROLE_LABEL[a.role] ? a.engineLabel : a.roleLabel}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
