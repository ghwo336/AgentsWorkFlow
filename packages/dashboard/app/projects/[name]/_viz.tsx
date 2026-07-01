"use client";

import { useState } from "react";
import type { Step } from "../../lib/types";
import { agentForStep, PixelAvatar, ROLE_COLOR } from "../../lib/agents";

// ── Shared step vocabulary (colors / icons / formatting) ────────────────────
const STATUS_COLOR: Record<string, string> = {
  passed: "var(--green)",
  failed: "var(--red)",
  running: "var(--yellow)",
  pending: "var(--muted)",
  skipped: "var(--muted)",
};
function statusColor(s: string): string {
  return STATUS_COLOR[s] ?? "var(--muted)";
}

const KIND_ICON: Record<string, string> = {
  plan: "📋",
  build: "🔨",
  verify: "🔍",
  review: "🧑‍⚖️",
  test: "🧪",
  commit: "✅",
};
function kindIcon(k: string): string {
  return KIND_ICON[k] ?? "•";
}

function endMs(step: Step, now: number): number {
  return step.endedAt ? new Date(step.endedAt).getTime() : now;
}
function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

// ── Tabbed container ────────────────────────────────────────────────────────
type Tab = "list" | "kanban" | "graph" | "timeline";
const TABS: { key: Tab; label: string }[] = [
  { key: "list", label: "리스트" },
  { key: "kanban", label: "칸반" },
  { key: "graph", label: "노드 그래프" },
  { key: "timeline", label: "타임라인" },
];

export function RunViz({ steps }: { steps: Step[] }) {
  const [tab, setTab] = useState<Tab>("list");

  return (
    <div className="panel">
      <div className="row spread" style={{ marginBottom: 12 }}>
        <b>진행 과정</b>
        <div className="viz-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`viz-tab${tab === t.key ? " active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {steps.length === 0 ? (
        <div className="muted small">아직 단계가 없습니다.</div>
      ) : tab === "list" ? (
        <StepListView steps={steps} />
      ) : tab === "kanban" ? (
        <KanbanView steps={steps} />
      ) : tab === "graph" ? (
        <GraphView steps={steps} />
      ) : (
        <TimelineView steps={steps} />
      )}
    </div>
  );
}

// ── 1) List (improved): progress bar + step rows ────────────────────────────
function StepListView({ steps }: { steps: Step[] }) {
  const now = Date.now();
  const done = steps.filter((s) => s.status === "passed").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const pct = Math.round((done / steps.length) * 100);

  return (
    <div>
      <div className="row spread small muted" style={{ marginBottom: 6 }}>
        <span>
          {done}/{steps.length} 완료{failed ? ` · ${failed} 실패` : ""}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="progress" style={{ marginBottom: 12 }}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {steps.map((s) => (
          <div key={s.id} className="step-row">
            <span className="step-dot" style={{ background: statusColor(s.status) }} />
            <span style={{ minWidth: 20 }}>{kindIcon(s.kind)}</span>
            <span className="step-label">{s.label}</span>
            <span className="agent-chip">
              <PixelAvatar agent={agentForStep(s)} size={18} />
              <span className="agent-chip-name" style={{ color: ROLE_COLOR[agentForStep(s).role] }}>
                {agentForStep(s).name}
              </span>
            </span>
            <span className="step-spacer" />
            {s.summary && (
              <span className="muted small step-summary" title={s.summary}>
                {s.summary}
              </span>
            )}
            <span className="small" style={{ color: statusColor(s.status), minWidth: 56, textAlign: "right" }}>
              {s.status === "running" ? "진행중" : fmtDur(endMs(s, now) - new Date(s.startedAt).getTime())}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 2) Kanban: one column per status ────────────────────────────────────────
const KAN_COLUMNS: { key: string; label: string }[] = [
  { key: "running", label: "진행중" },
  { key: "passed", label: "완료" },
  { key: "failed", label: "실패" },
  { key: "pending", label: "대기" },
];
function KanbanView({ steps }: { steps: Step[] }) {
  const cols = KAN_COLUMNS.filter(
    (c) => c.key !== "pending" || steps.some((s) => s.status === "pending")
  );
  return (
    <div className="table-scroll">
      <div className="kanban">
        {cols.map((c) => {
          const items = steps.filter((s) => s.status === c.key);
          return (
            <div key={c.key} className="kan-col">
              <div className="kan-head" style={{ color: statusColor(c.key) }}>
                {c.label} <span className="muted">({items.length})</span>
              </div>
              {items.map((s) => (
                <div key={s.id} className="kan-card" style={{ borderLeftColor: statusColor(s.status) }}>
                  <div>
                    {kindIcon(s.kind)} {s.label}
                  </div>
                  <div className="agent-chip" style={{ marginTop: 2 }}>
                    <PixelAvatar agent={agentForStep(s)} size={16} />
                    <span className="agent-chip-name" style={{ color: ROLE_COLOR[agentForStep(s).role] }}>
                      {agentForStep(s).name}
                    </span>
                  </div>
                  {s.summary && <div className="muted small kan-summary">{s.summary}</div>}
                </div>
              ))}
              {items.length === 0 && <div className="muted small">—</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 3) Node graph: parentId edges, laid out by depth ────────────────────────
function GraphView({ steps }: { steps: Step[] }) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  // depth = distance from a root (a step whose parent isn't in this run's set).
  const depthCache = new Map<string, number>();
  const depthOf = (s: Step): number => {
    if (depthCache.has(s.id)) return depthCache.get(s.id)!;
    const parent = s.parentId ? byId.get(s.parentId) : undefined;
    const d = parent ? depthOf(parent) + 1 : 0;
    depthCache.set(s.id, d);
    return d;
  };

  const COL_W = 200;
  const ROW_H = 76;
  const NODE_W = 168;
  const NODE_H = 52;
  const PAD = 12;

  // Group by depth (column); order within a column by orderIdx.
  const byDepth = new Map<number, Step[]>();
  for (const s of steps) {
    const d = depthOf(s);
    (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(s);
  }
  const pos = new Map<string, { x: number; y: number }>();
  let maxRow = 0;
  for (const [d, list] of byDepth) {
    list.sort((a, b) => a.orderIdx - b.orderIdx);
    list.forEach((s, i) => {
      pos.set(s.id, { x: PAD + d * COL_W, y: PAD + i * ROW_H });
      maxRow = Math.max(maxRow, i);
    });
  }
  const width = PAD * 2 + (byDepth.size - 1) * COL_W + NODE_W;
  const height = PAD * 2 + maxRow * ROW_H + NODE_H;

  return (
    <div className="table-scroll">
      <svg width={width} height={height} style={{ display: "block" }}>
        {/* edges */}
        {steps.map((s) => {
          if (!s.parentId || !pos.has(s.parentId) || !pos.has(s.id)) return null;
          const p = pos.get(s.parentId)!;
          const c = pos.get(s.id)!;
          const x1 = p.x + NODE_W;
          const y1 = p.y + NODE_H / 2;
          const x2 = c.x;
          const y2 = c.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={`e-${s.id}`}
              d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1.5}
            />
          );
        })}
        {/* nodes */}
        {steps.map((s) => {
          const p = pos.get(s.id)!;
          const color = statusColor(s.status);
          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill="var(--panel)"
                stroke={color}
                strokeWidth={1.5}
                className={s.status === "running" ? "node-running" : undefined}
              />
              <g transform="translate(8,6)">
                <PixelAvatar agent={agentForStep(s)} size={22} />
              </g>
              <text x={36} y={20} fill="var(--text)" fontSize={12}>
                {truncate(s.label, 13)}
              </text>
              <text x={36} y={36} fill={ROLE_COLOR[agentForStep(s).role]} fontSize={11}>
                {agentForStep(s).name} · {agentForStep(s).roleLabel}
              </text>
              <circle cx={NODE_W - 12} cy={14} r={5} fill={color} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ── 4) Timeline / gantt: startedAt→endedAt bars ─────────────────────────────
function TimelineView({ steps }: { steps: Step[] }) {
  const now = Date.now();
  const starts = steps.map((s) => new Date(s.startedAt).getTime());
  const ends = steps.map((s) => endMs(s, now));
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  const span = Math.max(1, max - min);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {steps.map((s) => {
        const start = new Date(s.startedAt).getTime();
        const end = endMs(s, now);
        const left = ((start - min) / span) * 100;
        const width = Math.max(1.5, ((end - start) / span) * 100);
        return (
          <div key={s.id} className="gantt-row">
            <span className="gantt-label" title={s.label}>
              {kindIcon(s.kind)} {s.label}
            </span>
            <span className="gantt-track">
              <span
                className={`gantt-bar${s.status === "running" ? " node-running" : ""}`}
                style={{ left: `${left}%`, width: `${width}%`, background: statusColor(s.status) }}
                title={`${fmtDur(end - start)}${s.summary ? ` — ${s.summary}` : ""}`}
              />
            </span>
            <span className="small muted gantt-dur">{fmtDur(end - start)}</span>
          </div>
        );
      })}
    </div>
  );
}
