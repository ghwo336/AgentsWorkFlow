"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { Markdown } from "../../lib/Markdown";
import type { ChatMessage, Run, RunDetail, RunEvent, StartRunInput, Step } from "../../lib/types";
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

// Turn the clarification thread into the run's brief. The planner reads this as
// the "original request", so we hand it the whole conversation — the user's asks
// and Opus's clarifications — not just the last line.
function briefFromChat(messages: ChatMessage[]): string {
  return messages
    .map((m) => (m.role === "user" ? `[요청] ${m.content}` : `[정리] ${m.content}`))
    .join("\n\n");
}

// New-task form. Starts as a conversation: the user chats with Opus to refine
// what they want (interactive requirements gathering), and only then kicks off a
// run — the whole thread becomes the brief. The repo field is pre-seeded from
// the project's remembered default (editable per run). Clears once a run starts.
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [targetDir, setTargetDir] = useState(defaultTargetDir);
  const [workspaceName, setWorkspaceName] = useState("");
  const seeded = useRef(false);
  const threadRef = useRef<HTMLDivElement>(null);

  // Seed the repo field once the project's default arrives (async), unless the
  // user already typed something.
  useEffect(() => {
    if (!seeded.current && defaultTargetDir && !targetDir) {
      setTargetDir(defaultTargetDir);
    }
    if (defaultTargetDir) seeded.current = true;
  }, [defaultTargetDir, targetDir]);

  // Keep the newest turn in view as the thread grows.
  useEffect(() => {
    threadRef.current?.scrollTo(0, threadRef.current.scrollHeight);
  }, [messages.length, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    setChatError(null);
    try {
      const { reply } = await api.chat(next);
      setMessages([...next, { role: "assistant", content: reply || "(응답이 비어 있습니다)" }]);
    } catch (err) {
      // Keep the user's message; let them retry. Surface the reason inline.
      setChatError(err instanceof Error ? err.message : "대화 요청 실패");
    } finally {
      setSending(false);
    }
  }

  async function startRun() {
    if (!title.trim() || messages.length === 0) return;
    const ok = await onStart({
      title: title.trim(),
      brief: briefFromChat(messages),
      targetDir: targetDir || undefined,
      // Only meaningful for a fresh (temp) workspace, i.e. no repo selected.
      workspaceName: targetDir ? undefined : workspaceName.trim() || undefined,
    });
    if (ok) {
      setTitle("");
      setMessages([]);
      setInput("");
      setWorkspaceName("");
      setChatError(null);
    }
  }

  const usingDefault = !!defaultTargetDir && targetDir === defaultTargetDir;
  const hasChat = messages.some((m) => m.role === "user");
  const canStart = !!title.trim() && hasChat && !sending;

  return (
    <div className="panel">
      <b>새 작업</b>
      <div className="muted small" style={{ marginTop: 4, marginBottom: 8 }}>
        Opus와 대화하며 요구사항을 정리한 뒤 계획을 시작하세요.
      </div>
      <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />

      <div className="chat-thread" ref={threadRef} style={{ marginTop: 8 }}>
        {messages.length === 0 && !sending && (
          <div className="muted small chat-empty">
            무엇을 만들까요? 아래에 편하게 적어주세요. Opus가 필요한 걸 되물으며 함께 정리합니다.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>
            <span className="chat-who">{m.role === "user" ? "나" : "Opus"}</span>
            <div className="chat-bubble">
              {m.role === "assistant" ? <Markdown>{m.content}</Markdown> : m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="chat-msg chat-assistant">
            <span className="chat-who">Opus</span>
            <div className="chat-bubble muted">…생각 중</div>
          </div>
        )}
      </div>

      {chatError && (
        <div className="small" style={{ color: "var(--red)", marginTop: 6 }}>
          {chatError}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <textarea
          placeholder="기획 / 요구사항을 적어주세요…  (Enter 전송 · Shift+Enter 줄바꿈)"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button type="button" className="ghost" onClick={send} disabled={!input.trim() || sending}>
            {sending ? "전송 중…" : "💬 보내기"}
          </button>
        </div>
      </div>

      <div style={{ height: 12, borderBottom: "1px solid var(--border)", marginBottom: 12 }} />

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
      <button type="button" onClick={startRun} disabled={!canStart}>
        ▶ 이 내용으로 계획 시작
      </button>
      {!canStart && (
        <div className="muted small" style={{ marginTop: 6 }}>
          {!title.trim()
            ? "제목을 입력하세요."
            : !hasChat
              ? "요구사항을 한 번 이상 보내세요."
              : ""}
        </div>
      )}
    </div>
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

// Run progress, told as the plan itself unfolds: 기획(호재) produces a plan that
// decomposes into N steps, and each step runs its own 구현→검증→(재시도)→커밋 loop.
// So instead of a fixed pipeline we render the plan step first, then one row per
// plan step showing that loop with the agent behind each action.

const FLOW_ICON: Record<string, string> = {
  plan: "📋",
  build: "🔨",
  verify: "🔍",
  review: "🔍",
  test: "🧪",
  commit: "✅",
};

function flowVerb(kind: string): string {
  switch (kind) {
    case "build":
      return "구현";
    case "verify":
    case "review":
      return "검증";
    case "test":
      return "테스트";
    case "commit":
      return "커밋";
    case "plan":
      return "기획";
    default:
      return kind;
  }
}

// Which plan step (1-based) a work-span belongs to. build/commit carry it in
// their label ("단계 N/M"); a verify/review/test span inherits it from its parent
// build via parentId.
function planStepNo(step: Step, byId: Map<string, Step>): number | null {
  const direct = step.label.match(/단계\s*(\d+)\s*\//);
  if (direct) return Number(direct[1]);
  let cur: Step | undefined = step;
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
    const m = cur?.label.match(/단계\s*(\d+)\s*\//);
    if (m) return Number(m[1]);
  }
  return null;
}

function planStepTotal(steps: Step[]): number {
  for (const s of steps) {
    const m = s.label.match(/단계\s*\d+\s*\/\s*(\d+)/);
    if (m) return Number(m[1]);
  }
  return 0;
}

type StepGroup = { no: number; steps: Step[] };

function groupByPlanStep(steps: Step[]): StepGroup[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const map = new Map<number, Step[]>();
  for (const s of steps) {
    if (s.kind === "plan") continue;
    const no = planStepNo(s, byId);
    if (no == null) continue;
    (map.get(no) ?? map.set(no, []).get(no)!).push(s);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([no, list]) => ({ no, steps: list.sort((a, b) => a.orderIdx - b.orderIdx) }));
}

function toneFor(status: string): "passed" | "failed" | "running" | "pending" {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "pending";
}

// One action in a plan step's loop: the icon, who did it, retry number, and a
// pass/fail/running mark.
function FlowPill({ step }: { step: Step }) {
  const agent = agentForStep(step);
  const tone = toneFor(step.status);
  const mark =
    step.status === "passed"
      ? "✓"
      : step.status === "failed"
        ? "✕"
        : step.status === "running"
          ? "…"
          : "•";
  return (
    <span className={`flow-pill flow-${tone}`} title={step.summary ?? step.label}>
      <span className="flow-ico">{FLOW_ICON[step.kind] ?? "•"}</span>
      <span className={step.status === "running" ? "blink" : undefined} style={{ display: "inline-flex" }}>
        <PixelAvatar agent={agent} size={18} />
      </span>
      <span className="flow-verb">
        {flowVerb(step.kind)}
        {step.attempt > 1 ? ` ${step.attempt}차` : ""} · {agent.name}
      </span>
      <span className="flow-mark">{mark}</span>
    </span>
  );
}

// One plan step: header (단계 N/M + 상태) and the horizontal 구현→검증→…→커밋 flow.
function StepGroupRow({ group, total }: { group: StepGroup; total: number }) {
  const committed = group.steps.some((s) => s.kind === "commit" && s.status === "passed");
  const running = group.steps.some((s) => s.status === "running");
  const badge = committed
    ? { icon: "✅", label: "완료", tone: "passed" }
    : running
      ? { icon: "⏳", label: "진행 중", tone: "running" }
      : { icon: "•", label: "대기", tone: "pending" };

  return (
    <div className="flow-group">
      <div className="flow-group-head">
        <b>단계 {group.no}{total ? `/${total}` : ""}</b>
        <span className={`badge step-${badge.tone}`}>
          {badge.icon} {badge.label}
        </span>
      </div>
      <div className="flow-line">
        {group.steps.map((s, i) => (
          <span key={s.id} className="flow-item">
            {i > 0 && <span className="flow-arrow">→</span>}
            <FlowPill step={s} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function RunProgress({ detail }: { detail: RunDetail }) {
  const planStep = detail.steps.find((s) => s.kind === "plan") ?? null;
  const groups = groupByPlanStep(detail.steps);
  const total = planStepTotal(detail.steps);
  const awaiting = detail.status === "awaiting_approval";
  const building = detail.status === "building" || detail.status === "verifying";
  const planDone = !!planStep && planStep.status === "passed";
  const hojae = agentById("hojae");
  const taekyung = agentById("taekyung");

  const planBadge = awaiting
    ? { icon: "⏳", label: "승인 대기", tone: "running" }
    : planDone
      ? { icon: "✅", label: "완료", tone: "passed" }
      : planStep?.status === "failed"
        ? { icon: "✕", label: "실패", tone: "failed" }
        : { icon: "⏳", label: "진행 중", tone: "running" };

  return (
    <div className="panel">
      <b>진행도</b>

      {/* 기획 — the plan gate lives here; 호재 blinks while awaiting approval. */}
      <div className="flow-group" style={{ marginTop: 10 }}>
        <div className="flow-group-head">
          <b>기획</b>
          <span className={`badge step-${planBadge.tone}`}>
            {planBadge.icon} {planBadge.label}
          </span>
        </div>
        <div className="flow-line">
          <span
            className={`flow-pill flow-${awaiting ? "running" : planDone ? "passed" : planStep?.status === "failed" ? "failed" : "pending"}`}
          >
            <span className="flow-ico">📋</span>
            <span className={awaiting ? "blink" : undefined} style={{ display: "inline-flex" }}>
              <PixelAvatar agent={hojae} size={18} />
            </span>
            <span className="flow-verb">기획 · {hojae.name}</span>
          </span>
        </div>
      </div>

      {awaiting && (
        <div className="muted small" style={{ margin: "10px 0 2px", textAlign: "center" }}>
          호재가 계획을 마치고{" "}
          <b style={{ color: "var(--yellow)" }}>승인을 기다리고 있어요</b> — 위에서 승인하거나 거절하세요.
        </div>
      )}

      {groups.map((g) => (
        <StepGroupRow key={g.no} group={g} total={total} />
      ))}

      {/* Between approval and the first build span appearing, show that work is
          spinning up so the click has a visible consequence. */}
      {groups.length === 0 && planDone && !awaiting && building && (
        <div className="flow-group" style={{ marginTop: 12 }}>
          <div className="flow-group-head">
            <b>구현 준비</b>
            <span className="badge step-running">⏳ 시작 중</span>
          </div>
          <div className="flow-line">
            <span className="flow-pill flow-running">
              <span className="flow-ico">🔨</span>
              <span className="blink" style={{ display: "inline-flex" }}>
                <PixelAvatar agent={taekyung} size={18} />
              </span>
              <span className="flow-verb">태경이 구현을 준비하는 중…</span>
            </span>
          </div>
        </div>
      )}

      {groups.length === 0 && planDone && !awaiting && !building && (
        <div className="muted small" style={{ marginTop: 10 }}>
          승인 후 단계별 구현이 시작됩니다.
        </div>
      )}
    </div>
  );
}

type SummaryFilter = "all" | "done" | "error";

export function AgentWorkSummary({
  steps,
  status,
  plan,
}: {
  steps: Step[];
  status?: string;
  plan?: string;
}) {
  const [filter, setFilter] = useState<SummaryFilter>("all");
  const awaitingApproval = status === "awaiting_approval";
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
            <SummaryItem
              key={step.id}
              step={step}
              awaitingApproval={awaitingApproval && step.kind === "plan"}
              // The plan step's stored summary is compacted; show the full plan
              // (markdown) when expanded so 더보기 actually reveals everything.
              fullText={step.kind === "plan" ? plan : undefined}
            />
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

function stepOutcome(step: Step, awaitingApproval = false): Outcome {
  const isVerify = step.kind === "verify" || step.kind === "review" || step.kind === "test";
  if (step.status === "running") return { icon: "⏳", label: isVerify ? "검토 중" : "진행 중", tone: "running" };
  if (step.status === "skipped") return { icon: "⏭️", label: "건너뜀", tone: "pending" };
  // Plan is done but not yet approved — signal it's a pending gate, not a
  // finished task (amber tone), so it doesn't read as "approved / done".
  if (awaitingApproval && step.kind === "plan" && step.status === "passed") {
    return { icon: "⏳", label: "기획 완료 · 승인 대기", tone: "running" };
  }
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
function SummaryItem({
  step,
  awaitingApproval = false,
  fullText,
}: {
  step: Step;
  awaitingApproval?: boolean;
  fullText?: string;
}) {
  const agent = agentForStep(step);
  const outcome = stepOutcome(step, awaitingApproval);
  const [expanded, setExpanded] = useState(false);
  // Prefer the full text (e.g. the whole plan) over the compacted summary, so
  // expanding really shows everything.
  const body =
    fullText?.trim() ||
    step.summary?.trim() ||
    (step.status === "running" ? "진행 중입니다." : "요약이 없습니다.");
  const long = body.length > 180;
  const collapsed = long && !expanded ? `${body.slice(0, 180).trimEnd()}…` : body;
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
        {/* Collapsed → plain truncated text (never cut markdown mid-syntax);
            expanded → full text rendered as markdown. */}
        {expanded ? <Markdown>{body}</Markdown> : collapsed}
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
  onApprove: (editedPlan: string) => void | Promise<void>;
  onReject: () => void | Promise<void>;
  onRevise: (feedback: string) => void | Promise<void>;
}) {
  const [editedPlan, setEditedPlan] = useState(plan);
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState(false); // preview (rendered) by default
  // Immediate feedback on click — the approve/build kick is async and the panel
  // only unmounts once the status flips, so without this the user sees nothing
  // happen for a beat and assumes the click didn't register.
  const [busy, setBusy] = useState<null | "approve" | "reject" | "revise">(null);

  useEffect(() => {
    setEditedPlan(plan);
    setFeedback(""); // a fresh plan arrived → clear the previous feedback
    setEditing(false);
    setBusy(null); // a new/revised plan arrived → re-enable the controls
  }, [plan]);

  async function run(kind: "approve" | "reject" | "revise", fn: () => void | Promise<void>) {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch {
      setBusy(null); // failed → let them retry (success unmounts/re-seeds the panel)
    }
  }

  return (
    <div className="panel" style={{ borderColor: "var(--accent)" }}>
      <div className="row spread">
        <b>★ 계획 — 승인 / 수정</b>
        <button
          className="ghost small"
          style={{ boxShadow: "none", padding: "2px 8px" }}
          disabled={!!busy}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "👁 미리보기" : "✏️ 편집"}
        </button>
      </div>
      <div style={{ height: 8 }} />
      {editing ? (
        <textarea rows={14} value={editedPlan} onChange={(e) => setEditedPlan(e.target.value)} />
      ) : (
        <div className="plan-preview">
          <Markdown>{editedPlan}</Markdown>
        </div>
      )}
      <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
        <button disabled={!!busy} onClick={() => run("approve", () => onApprove(editedPlan))}>
          {busy === "approve" ? "⏳ 구현 시작 중…" : "✅ 승인 → 구현"}
        </button>
        <button className="danger" disabled={!!busy} onClick={() => run("reject", onReject)}>
          {busy === "reject" ? "처리 중…" : "✖ 거절"}
        </button>
        <span className="muted small" style={{ flex: "1 1 100%" }}>
          {busy === "approve"
            ? "승인됨 — 태경이 구현을 준비하고 있어요…"
            : editing
              ? "편집 후 승인하면 수정된 계획으로 진행됩니다."
              : "✏️ 편집으로 직접 고칠 수 있어요."}
        </span>
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
          disabled={!!busy}
        />
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button
            className="ghost"
            disabled={!feedback.trim() || !!busy}
            onClick={() => run("revise", () => onRevise(feedback.trim()))}
          >
            {busy === "revise" ? "⏳ 다시 세우는 중…" : "🔁 수정 요청"}
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

