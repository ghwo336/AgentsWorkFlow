"use client";

import { useEffect, useRef, useState } from "react";
import type { Run, RunDetail, RunEvent, StartRunInput, Step } from "../../lib/types";
import { agentById, agentForEvent, agentForStep, PixelAvatar, ROLE_COLOR } from "../../lib/agents";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge b-${status}`}>{status}</span>;
}

// Repo chooser: a dropdown of git repos detected on the server, with an empty
// "temp workspace" option and a "직접 입력" escape hatch for paths not in the
// list. Keeps users from hand-typing absolute paths.
function repoLabel(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  const name = parts.pop() || path;
  return `📁 ${name}  —  ${parts.join("/")}`;
}

export function RepoPicker({
  value,
  repos,
  onChange,
}: {
  value: string;
  repos: string[];
  onChange: (v: string) => void;
}) {
  // Manual mode when the current value is a real path not in the detected list.
  const [manual, setManual] = useState(!!value && !repos.includes(value));
  useEffect(() => {
    if (!value || repos.includes(value)) setManual(false);
  }, [value, repos]);

  return (
    <div>
      <select
        value={manual ? "__manual__" : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__manual__") {
            setManual(true);
          } else {
            setManual(false);
            onChange(v);
          }
        }}
      >
        <option value="">(임시 워크스페이스 — 매번 새 폴더)</option>
        {repos.map((r) => (
          <option key={r} value={r}>
            {repoLabel(r)}
          </option>
        ))}
        <option value="__manual__">✏️ 직접 경로 입력…</option>
      </select>
      {manual && (
        <input
          style={{ marginTop: 8 }}
          placeholder="/path/to/repo"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

// New-task form. Owns its own input state and hands a completed request to the
// parent; clears the title/brief once a run actually starts. The repo field is
// pre-seeded from the project's remembered default (editable per run).
export function NewTaskForm({
  onStart,
  defaultTargetDir = "",
  repos,
}: {
  onStart: (input: StartRunInput) => Promise<boolean>;
  defaultTargetDir?: string;
  repos: string[];
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [targetDir, setTargetDir] = useState(defaultTargetDir);
  const [workspaceName, setWorkspaceName] = useState("");
  const seeded = useRef(false);

  // Seed the repo field once the project's default arrives (async), unless the
  // user already typed something.
  useEffect(() => {
    if (!seeded.current && defaultTargetDir && !targetDir) {
      setTargetDir(defaultTargetDir);
    }
    if (defaultTargetDir) seeded.current = true;
  }, [defaultTargetDir, targetDir]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !brief) return;
    const ok = await onStart({
      title,
      brief,
      targetDir: targetDir || undefined,
      // Only meaningful for a fresh (temp) workspace, i.e. no repo selected.
      workspaceName: targetDir ? undefined : workspaceName.trim() || undefined,
    });
    if (ok) {
      setTitle("");
      setBrief("");
      setWorkspaceName("");
    }
  }

  const usingDefault = !!defaultTargetDir && targetDir === defaultTargetDir;

  return (
    <form className="panel" onSubmit={submit}>
      <b>새 작업</b>
      <div style={{ height: 8 }} />
      <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ height: 8 }} />
      <textarea
        placeholder="기획 / 요구사항을 적어주세요…"
        rows={5}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
      <div style={{ height: 8 }} />
      <RepoPicker value={targetDir} repos={repos} onChange={setTargetDir} />
      <div className="muted small" style={{ marginTop: 4 }}>
        {usingDefault
          ? "프로젝트 기본 저장소 사용 중"
          : targetDir
            ? "이 작업에만 적용되는 저장소"
            : "새 임시 폴더에서 작업합니다 (아래에서 이름 지정 가능)"}
      </div>
      {!targetDir && (
        <>
          <div style={{ height: 8 }} />
          <input
            placeholder="워크스페이스 폴더 이름 (선택 — 비우면 자동)"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
          {workspaceName.trim() && (
            <div className="muted small" style={{ marginTop: 4 }}>
              생성 위치: workspaces/{workspaceName.trim().replace(/[^a-zA-Z0-9._-]/g, "-")}
            </div>
          )}
        </>
      )}
      <div style={{ height: 8 }} />
      <button type="submit">▶ Plan with Opus</button>
    </form>
  );
}

// Project-level default repo dir. Persisted on the project, so every new run in
// it starts pre-filled instead of re-typing the path each time.
export function ProjectSettings({
  defaultTargetDir,
  repos,
  onSave,
}: {
  defaultTargetDir: string;
  repos: string[];
  onSave: (dir: string) => Promise<void>;
}) {
  const [dir, setDir] = useState(defaultTargetDir);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDir(defaultTargetDir), [defaultTargetDir]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(dir.trim());
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const dirty = dir.trim() !== defaultTargetDir;

  return (
    <div className="panel">
      <b>기본 저장소</b>
      <div className="muted small" style={{ marginTop: 4, marginBottom: 8 }}>
        이 프로젝트의 새 작업에 자동으로 채워집니다.
      </div>
      <RepoPicker
        value={dir}
        repos={repos}
        onChange={(v) => {
          setDir(v);
          setSaved(false);
        }}
      />
      <div className="row" style={{ marginTop: 8, gap: 8, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={saving || !dirty}>
          {saving ? "저장 중…" : "저장"}
        </button>
        {saved && !dirty && <span className="muted small">✅ 저장됨</span>}
      </div>
    </div>
  );
}

export function RunList({
  runs,
  selected,
  onSelect,
}: {
  runs: Run[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="panel">
      <b>작업 목록</b>
      <div style={{ height: 8 }} />
      {runs.map((r) => (
        <div
          key={r.id}
          className="row spread"
          style={{ padding: "6px 0", cursor: "pointer", opacity: r.id === selected ? 1 : 0.7 }}
          onClick={() => onSelect(r.id)}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.title}
          </span>
          <StatusBadge status={r.status} />
        </div>
      ))}
      {runs.length === 0 && <span className="muted small">아직 작업이 없습니다.</span>}
    </div>
  );
}

export function RunDetailCard({ detail }: { detail: RunDetail }) {
  return (
    <div className="panel">
      <div className="row spread">
        <b>{detail.title}</b>
        <StatusBadge status={detail.status} />
      </div>
      <div className="muted small" style={{ marginTop: 4 }}>
        {detail.targetDir}
      </div>
      {detail.commit && (
        <div className="small" style={{ marginTop: 6 }}>
          ✅ committed <code>{detail.commit.slice(0, 10)}</code>
        </div>
      )}
      {detail.error && (
        <div className="small" style={{ marginTop: 6, color: "var(--red)" }}>
          {detail.error}
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <a href={`/runs/${detail.id}`} className="small">
          전체 상세 보기 →
        </a>
      </div>
    </div>
  );
}

// Phase progress bar for one run. Turns the single status badge into an
// at-a-glance "어디쯤인지" stepper across the fixed pipeline stages.
const PHASES: { key: string; label: string; agentId?: string }[] = [
  { key: "planning", label: "기획", agentId: "hojae" },
  { key: "awaiting_approval", label: "승인" },
  { key: "building", label: "빌드", agentId: "taekyung" },
  { key: "verifying", label: "검증", agentId: "juho" },
  { key: "committed", label: "완료", agentId: "system" },
];

function kindPhaseIndex(kind: string): number {
  switch (kind) {
    case "plan":
      return 0;
    case "build":
      return 2;
    case "verify":
    case "review":
    case "test":
      return 3;
    case "commit":
      return 4;
    default:
      return 0;
  }
}

// Best-effort mapping of a run to a phase index + whether it's done/failed.
// Happy-path statuses map directly; terminal errors infer the furthest phase
// reached from the steps (there is no step for the approval gate).
function runProgress(detail: RunDetail): { reached: number; failed: boolean; done: boolean } {
  const status = detail.status;
  if (status === "committed") return { reached: 4, failed: false, done: true };
  const idx = PHASES.findIndex((p) => p.key === status);
  if (idx >= 0) return { reached: idx, failed: false, done: false };

  // rejected / failed / cancelled → how far did it get?
  let reached = 0;
  for (const s of detail.steps) reached = Math.max(reached, kindPhaseIndex(s.kind));
  if (detail.plan && reached < 1) reached = 1; // a plan was produced → reached approval
  return { reached, failed: true, done: false };
}

export function RunProgress({ detail }: { detail: RunDetail }) {
  const { reached, failed, done } = runProgress(detail);

  return (
    <div className="panel">
      <b>진행도</b>
      <div className="stepper" style={{ marginTop: 10 }}>
        {PHASES.map((p, i) => {
          let state: "done" | "current" | "pending" | "failed";
          if (done) state = "done";
          else if (failed) state = i < reached ? "done" : i === reached ? "failed" : "pending";
          else state = i < reached ? "done" : i === reached ? "current" : "pending";

          const agent = p.agentId ? agentById(p.agentId) : null;
          return (
            <div key={p.key} className={`step-node s-${state}`}>
              <div className="step-dot">
                {agent ? (
                  <span className={state === "current" ? "bob" : undefined}>
                    <PixelAvatar agent={agent} size={30} />
                  </span>
                ) : state === "done" ? (
                  "✓"
                ) : state === "failed" ? (
                  "✕"
                ) : (
                  "🔑"
                )}
              </div>
              <div className="step-label">{p.label}</div>
              {agent && <div className="step-who">{agent.name}</div>}
              {i < PHASES.length - 1 && <div className="step-bar" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type SummaryFilter = "all" | "done" | "error";

export function AgentWorkSummary({ steps }: { steps: Step[] }) {
  const [filter, setFilter] = useState<SummaryFilter>("all");
  const visible = steps.filter((step) => step.kind !== "commit" || step.summary);

  const doneCount = visible.filter((s) => s.status === "passed").length;
  const errorCount = visible.filter((s) => s.status === "failed").length;
  const shown = visible.filter((s) =>
    filter === "done" ? s.status === "passed" : filter === "error" ? s.status === "failed" : true
  );

  const TABS: { key: SummaryFilter; label: string }[] = [
    { key: "all", label: `전체 ${visible.length}` },
    { key: "done", label: `✅ 구현 ${doneCount}` },
    { key: "error", label: `⚠️ 오류 ${errorCount}` },
  ];

  return (
    <div className="panel">
      <div className="row spread" style={{ marginBottom: 10 }}>
        <b>작업 요약</b>
        <div className="viz-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`viz-tab${filter === t.key ? " active" : ""}`}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="muted small">아직 정리할 작업이 없습니다.</div>
      ) : shown.length === 0 ? (
        <div className="muted small">
          {filter === "done" ? "아직 구현 완료된 작업이 없습니다." : "발생한 오류가 없습니다. 🎉"}
        </div>
      ) : (
        <div className="agent-summary-list">
          {shown.map((step) => (
            <SummaryItem key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

// codex/infra execution failures (vs. a genuine review rejection). These mean
// "codex couldn't run", not "your code is wrong" — labelled distinctly so a
// transient failure isn't mistaken for a real defect.
const INFRA_FAIL =
  /(failed to run|could not parse|timed out|exceeded maxbuffer|reading additional input|무한\s*대기|실행(에|)\s*실패|stdin)/i;

type Outcome = { icon: string; label: string; tone: string };

function stepOutcome(step: Step): Outcome {
  const isVerify = step.kind === "verify" || step.kind === "review" || step.kind === "test";
  if (step.status === "running") return { icon: "⏳", label: isVerify ? "검토 중" : "진행 중", tone: "running" };
  if (step.status === "skipped") return { icon: "⏭️", label: "건너뜀", tone: "pending" };
  if (isVerify) {
    if (step.status === "passed") return { icon: "✅", label: "통과 · 문제없음", tone: "passed" };
    if (step.status === "failed") {
      return step.summary && INFRA_FAIL.test(step.summary)
        ? { icon: "⚠️", label: "실행오류 · 검토못함", tone: "warn" }
        : { icon: "❌", label: "오류 지적", tone: "failed" };
    }
  }
  if (step.status === "passed") {
    if (step.kind === "plan") return { icon: "📋", label: "기획 완료", tone: "passed" };
    if (step.kind === "build") return { icon: "🔨", label: "구현 완료", tone: "passed" };
    if (step.kind === "commit") return { icon: "✅", label: "커밋", tone: "passed" };
    return { icon: "✅", label: "완료", tone: "passed" };
  }
  if (step.status === "failed") return { icon: "❌", label: "실패", tone: "failed" };
  return { icon: "•", label: "대기", tone: "pending" };
}

// One work-summary card: who did it, the outcome verdict, and the summary body
// (codex review reason / build "무엇을 했는지"), clamped with a 더보기 toggle.
function SummaryItem({ step }: { step: Step }) {
  const agent = agentForStep(step);
  const outcome = stepOutcome(step);
  const [expanded, setExpanded] = useState(false);
  const body =
    step.summary?.trim() || (step.status === "running" ? "진행 중입니다." : "요약이 없습니다.");
  const long = body.length > 180;
  const shownBody = long && !expanded ? `${body.slice(0, 180).trimEnd()}…` : body;
  const bodyLabel =
    step.kind === "build" ? "구현 내용" : step.kind === "plan" ? "계획 요약" : "리뷰 결과";

  return (
    <div className={`agent-summary-item role-${agent.role}`}>
      <div className="row spread agent-summary-head">
        <div className="agent-summary-who">
          <PixelAvatar agent={agent} size={34} />
          <div>
            <b style={{ color: ROLE_COLOR[agent.role] }}>{agent.name}</b>
            <span className="muted small">
              {" "}
              {agent.roleLabel} · {step.label}
              {step.attempt > 1 ? ` · ${step.attempt}차` : ""}
            </span>
          </div>
        </div>
        <span className={`badge step-${outcome.tone}`} style={{ whiteSpace: "nowrap" }}>
          {outcome.icon} {outcome.label}
        </span>
      </div>
      <div className="agent-summary-body">
        <span className="muted small">{bodyLabel} · </span>
        {shownBody}
      </div>
      {long && (
        <button
          className="ghost small"
          style={{ marginTop: 6, boxShadow: "none", padding: "2px 8px" }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "접기 ▾" : "더보기 ▸"}
        </button>
      )}
    </div>
  );
}

// Approval gate UI. Owns the editable plan text (re-seeded whenever a new plan
// arrives) and a feedback box that sends the plan back to Opus for revision —
// an interactive refine loop before approving.
export function ApprovalPanel({
  plan,
  onApprove,
  onReject,
  onRevise,
}: {
  plan: string;
  onApprove: (editedPlan: string) => void;
  onReject: () => void;
  onRevise: (feedback: string) => void;
}) {
  const [editedPlan, setEditedPlan] = useState(plan);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    setEditedPlan(plan);
    setFeedback(""); // a fresh plan arrived → clear the previous feedback
  }, [plan]);

  return (
    <div className="panel" style={{ borderColor: "var(--accent)" }}>
      <b>★ 계획 — 승인 / 수정</b>
      <div style={{ height: 8 }} />
      <textarea rows={14} value={editedPlan} onChange={(e) => setEditedPlan(e.target.value)} />
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button onClick={() => onApprove(editedPlan)}>✅ 승인 → 구현</button>
        <button className="danger" onClick={onReject}>
          ✖ 거절
        </button>
        <span className="muted small">편집 후 승인하면 수정된 계획으로 진행됩니다.</span>
      </div>

      <div
        style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}
      >
        <div className="muted small" style={{ marginBottom: 6 }}>
          고치고 싶은 점을 적으면 Opus가 계획을 다시 세웁니다 (반복 가능):
        </div>
        <textarea
          rows={3}
          placeholder="예: 3단계가 너무 크니 둘로 나눠줘 / 인증은 JWT로 바꿔줘"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button
            className="ghost"
            disabled={!feedback.trim()}
            onClick={() => onRevise(feedback.trim())}
          >
            🔁 수정 요청
          </button>
        </div>
      </div>
    </div>
  );
}

// Live timeline. Collapsed by default (raw firehose — only opened when needed);
// owns auto-scroll-to-bottom while open.
export function LiveLog({ events }: { events: RunEvent[] }) {
  const [open, setOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [events.length, open]);

  return (
    <div className="panel">
      <div
        className="row spread"
        style={{ cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        <b>
          실시간 로그 <span className="muted small">({events.length})</span>
        </b>
        <button className="ghost small" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
          {open ? "접기 ▾" : "펼치기 ▸"}
        </button>
      </div>
      {!open ? null : (
      <>
      <div style={{ height: 8 }} />
      <div className="log" ref={logRef}>
        {events.map((ev) => {
          const agent = agentForEvent(ev);
          return (
            <div key={ev.id} className="line">
              <span className="ph">{ev.phase}</span>
              <span className="who" title={`${agent.name} · ${agent.engineLabel}`}>
                <PixelAvatar agent={agent} size={16} />
                <span className="who-name" style={{ color: ROLE_COLOR[agent.role] }}>
                  {agent.name}
                </span>
              </span>
              <span className={ev.level === "error" ? "err" : ev.level === "warn" ? "warn" : ""}>
                {ev.message}
              </span>
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}

