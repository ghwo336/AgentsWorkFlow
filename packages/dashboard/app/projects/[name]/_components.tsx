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
}: {
  onStart: (input: StartRunInput) => Promise<boolean>;
  defaultTargetDir?: string;
}) {
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

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
    // The chat is optional refinement — you can also just type the requirements
    // and hit start. So fold any un-sent input into the brief instead of forcing
    // a send() round-trip first.
    const pending = input.trim();
    const thread: ChatMessage[] = pending
      ? [...messages, { role: "user", content: pending }]
      : messages;
    if (thread.length === 0 || sending) return;
    const brief = briefFromChat(thread);
    // Title is optional: derive one from the first request line when left blank.
    const firstAsk = thread.find((m) => m.role === "user")?.content ?? "";
    const derivedTitle =
      title.trim() || firstAsk.split("\n")[0].trim().slice(0, 60) || "새 작업";
    // No path input: the orchestrator runs this in the project's own folder
    // (agent-workspaces/<project>), creating/reusing it automatically.
    const ok = await onStart({ title: derivedTitle, brief });
    if (ok) {
      setTitle("");
      setMessages([]);
      setInput("");
      setChatError(null);
    }
  }

  const folderName = defaultTargetDir ? defaultTargetDir.replace(/\/+$/, "").split("/").pop() : "";
  const hasChat = messages.some((m) => m.role === "user");
  // Startable as soon as there's *any* requirement text — either a sent chat
  // turn or something typed in the box. Title is auto-derived when empty.
  const canStart = (hasChat || !!input.trim()) && !sending;

  return (
    <div className="panel">
      <b>새 작업</b>
      <div className="muted small" style={{ marginTop: 4, marginBottom: 8 }}>
        Opus와 대화하며 요구사항을 정리한 뒤 계획을 시작하세요.
      </div>
      <input placeholder="제목 (비워두면 자동 생성)" value={title} onChange={(e) => setTitle(e.target.value)} />

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

      <div className="muted small">
        📁 이 프로젝트 폴더에서 작업합니다
        {folderName ? (
          <>
            {" — "}
            <code>{folderName}</code>
          </>
        ) : (
          " (첫 작업 시 자동 생성)"
        )}
        . 다른 저장소를 쓰려면 위 <b>기본 저장소</b>에서 지정하세요.
      </div>
      <div style={{ height: 8 }} />
      <button type="button" onClick={startRun} disabled={!canStart}>
        ▶ 이 내용으로 계획 시작
      </button>
      {!canStart && (
        <div className="muted small" style={{ marginTop: 6 }}>
          요구사항을 적어주세요. (Opus와 대화로 다듬어도 되고, 바로 시작해도 됩니다)
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

// The decomposed plan-step descriptions ("무엇을 하는지"), persisted on the run
// when the plan is approved. Available even before approval, so the table can
// show the whole roadmap upfront.
function planStepDescriptions(detail: RunDetail): string[] {
  try {
    const raw = (detail as { planSteps?: string | null }).planSteps;
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

type RowState = { icon: string; label: string; tone: "passed" | "failed" | "running" | "pending" };

// A plan-step row's status, derived from its work-span group (if it has started).
function planRowState(group: StepGroup | undefined): RowState {
  if (!group) return { icon: "•", label: "대기", tone: "pending" };
  if (group.steps.some((s) => s.kind === "commit" && s.status === "passed"))
    return { icon: "✅", label: "완료", tone: "passed" };
  if (group.steps.some((s) => s.status === "running"))
    return { icon: "⏳", label: "진행 중", tone: "running" };
  if (group.steps.some((s) => s.status === "failed"))
    return { icon: "🔁", label: "재시도 중", tone: "failed" };
  return { icon: "⏳", label: "진행 중", tone: "running" };
}

// Who's on the row: the actual builder once it starts, else 태경 as the default
// upcoming assignee.
function planRowAgent(group: StepGroup | undefined) {
  const build = group?.steps.find((s) => s.kind === "build");
  return build ? agentForStep(build) : agentById("taekyung");
}

// The 단계별 roadmap as a table: every plan step as a row (작업 내용 · 담당 · 상태),
// visible from approval onward. The active step expands to show its live
// 구현→검증→커밋 loop inline.
function PlanStepTable({
  descriptions,
  groups,
  total,
  needsInput = false,
}: {
  descriptions: string[];
  groups: StepGroup[];
  total: number;
  needsInput?: boolean;
}) {
  const groupByNo = new Map(groups.map((g) => [g.no, g]));
  const count = Math.max(descriptions.length, total, groups.length);
  const rows = Array.from({ length: count }, (_, i) => i + 1);
  const doneCount = rows.filter((no) => planRowState(groupByNo.get(no)).tone === "passed").length;

  return (
    <div className="plan-table" style={{ marginTop: 12 }}>
      <div className="plan-table-caption">
        <b>단계별 작업</b>
        <span className="muted small">
          {doneCount}/{count} 완료
        </span>
      </div>
      <div className="plan-thead">
        <span>#</span>
        <span>작업 내용</span>
        <span>담당</span>
        <span>상태</span>
      </div>
      {rows.map((no) => {
        const group = groupByNo.get(no);
        let st = planRowState(group);
        // While parked at needs_input, the stuck step is the one with failed
        // work and no commit — surface it as "개입 대기", not "재시도 중".
        if (needsInput && st.tone === "failed") {
          st = { icon: "🚧", label: "개입 대기", tone: "failed" };
        }
        const agent = planRowAgent(group);
        const desc = descriptions[no - 1] ?? `단계 ${no}`;
        const showFlow = !!group && st.tone !== "pending";
        return (
          <div key={no} className={`plan-trow plan-${st.tone}`}>
            <span className="plan-no">{no}</span>
            <span className="plan-desc">
              {desc}
              {showFlow && group && (
                <span className="plan-subflow">
                  {group.steps.map((s, i) => (
                    <span key={s.id} className="flow-item">
                      {i > 0 && <span className="flow-arrow">→</span>}
                      <FlowPill step={s} />
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="plan-who">
              <PixelAvatar agent={agent} size={20} active={st.tone === "running"} />
              <span style={{ color: ROLE_COLOR[agent.role] }}>{agent.name}</span>
            </span>
            <span className="plan-status">
              <span className={`badge step-${st.tone}`}>
                {st.icon} {st.label}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
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
        <PixelAvatar agent={agent} size={18} active={step.status === "running"} />
      </span>
      <span className="flow-verb">
        {flowVerb(step.kind)}
        {step.attempt > 1 ? ` ${step.attempt}차` : ""} · {agent.name}
      </span>
      <span className="flow-mark">{mark}</span>
    </span>
  );
}


export function RunProgress({ detail }: { detail: RunDetail }) {
  const planStep = detail.steps.find((s) => s.kind === "plan") ?? null;
  const groups = groupByPlanStep(detail.steps);
  const descriptions = planStepDescriptions(detail);
  const total = planStepTotal(detail.steps) || descriptions.length;
  const awaiting = detail.status === "awaiting_approval";
  const building = detail.status === "building" || detail.status === "verifying";
  const planDone = !!planStep && planStep.status === "passed";
  const planFailed = planStep?.status === "failed";
  // 호재 is actively thinking whenever the plan step is running (or the run is
  // spinning up before the step even lands). This is the long, silent stretch
  // that felt "frozen" — so make him visibly work (fire + blink), not idle grey.
  const planRunning = !awaiting && !planDone && !planFailed;
  const hojae = agentById("hojae");

  const planBadge = awaiting
    ? { icon: "⏳", label: "승인 대기", tone: "running" }
    : planDone
      ? { icon: "✅", label: "완료", tone: "passed" }
      : planFailed
        ? { icon: "✕", label: "실패", tone: "failed" }
        : { icon: "⏳", label: "기획하는 중…", tone: "running" };

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
            className={`flow-pill flow-${awaiting || planRunning ? "running" : planDone ? "passed" : "failed"}`}
          >
            <span className="flow-ico">📋</span>
            <span className={awaiting ? "blink" : undefined} style={{ display: "inline-flex" }}>
              {/* on fire while thinking, blinking while waiting for you */}
              <PixelAvatar agent={hojae} size={18} active={planRunning} />
            </span>
            <span className="flow-verb">기획 · {hojae.name}</span>
          </span>
        </div>
      </div>

      {planRunning && (
        <div className="muted small planning-live" style={{ margin: "10px 0 2px", textAlign: "center" }}>
          <span className="planning-dots" aria-hidden />
          호재가 요구사항을 뜯어보며{" "}
          <b style={{ color: "var(--yellow)" }}>계획을 세우는 중</b>이에요 — 30초~1분 정도 걸릴 수 있어요.
        </div>
      )}

      {awaiting && (
        <div className="muted small" style={{ margin: "10px 0 2px", textAlign: "center" }}>
          호재가 계획을 마치고{" "}
          <b style={{ color: "var(--yellow)" }}>승인을 기다리고 있어요</b> — 위에서 승인하거나 거절하세요.
        </div>
      )}

      {/* 단계별 작업 — the whole roadmap as a table, from approval onward. */}
      {(descriptions.length > 0 || groups.length > 0) && (
        <PlanStepTable
          descriptions={descriptions}
          groups={groups}
          total={total}
          needsInput={detail.status === "needs_input"}
        />
      )}

      {/* Approval → first build span: the table already lists every step as 대기,
          so just note that work is kicking off. */}
      {groups.length === 0 && planDone && !awaiting && building && (
        <div className="muted small planning-live" style={{ marginTop: 10, textAlign: "center" }}>
          <span className="planning-dots" aria-hidden />
          태경이 1단계 구현을 준비하는 중…
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
          <PixelAvatar agent={agent} size={34} active={step.status === "running"} />
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

// Intervention gate: shown when a step is stuck (needs_input) — after the
// builders' retries AND 호재's escalation both failed. The user is the final
// escalation: give fix guidance (re-runs the step), accept the current attempt
// as-is, skip the step, or stop the run.
export function InterventionPanel({
  reason,
  onGuide,
  onCommit,
  onSkip,
  onAbort,
}: {
  reason?: string | null;
  onGuide: (feedback: string) => void | Promise<void>;
  onCommit: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  onAbort: () => void | Promise<void>;
}) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<null | "guide" | "commit" | "skip" | "abort">(null);
  const hojae = agentById("hojae");

  async function run(kind: "guide" | "commit" | "skip" | "abort", fn: () => void | Promise<void>) {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch {
      setBusy(null); // failed → let them retry (success flips status + unmounts)
    }
  }

  return (
    <div className="panel" style={{ borderColor: "var(--yellow)" }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <PixelAvatar agent={hojae} size={28} />
        <b>🚧 막힌 단계 — 개입이 필요해요</b>
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>
        태경·민재가 여러 번 시도하고 <b style={{ color: ROLE_COLOR.plan }}>호재</b>가 개입해 해결책까지
        제시했지만 이 단계가 검증을 통과하지 못했습니다. 어떻게 진행할까요?
      </div>
      {reason && (
        <div className="plan-preview" style={{ marginTop: 10 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>마지막 검증 사유</div>
          <Markdown>{reason}</Markdown>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div className="muted small" style={{ marginBottom: 6 }}>
          직접 지침을 주면 그대로 이 단계를 다시 시도합니다 (가장 권장):
        </div>
        <textarea
          rows={3}
          placeholder="예: prisma를 6.x로 낮춰서 @auth/prisma-adapter와 맞춰줘 / next는 15.3.4 정확히 써"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          disabled={!!busy}
        />
        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          <button
            disabled={!feedback.trim() || !!busy}
            onClick={() => run("guide", () => onGuide(feedback.trim()))}
          >
            {busy === "guide" ? "⏳ 다시 시도 중…" : "🧭 지침 주고 다시 시도"}
          </button>
          <button className="ghost" disabled={!!busy} onClick={() => run("commit", onCommit)}>
            {busy === "commit" ? "처리 중…" : "✅ 현재 상태로 커밋"}
          </button>
          <button className="ghost" disabled={!!busy} onClick={() => run("skip", onSkip)}>
            {busy === "skip" ? "처리 중…" : "⏭️ 이 단계 건너뛰기"}
          </button>
          <button className="danger" disabled={!!busy} onClick={() => run("abort", onAbort)}>
            {busy === "abort" ? "처리 중…" : "✖ 중단"}
          </button>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          <b>커밋</b>: 지금까지의 변경을 그대로 확정하고 다음 단계로 · <b>건너뛰기</b>: 이 단계 변경을
          버리고 다음 단계로 · <b>중단</b>: 작업 종료.
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
