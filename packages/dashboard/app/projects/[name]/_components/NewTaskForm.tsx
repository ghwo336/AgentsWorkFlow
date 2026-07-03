"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";
import {
  agentById,
  ALL_SEAT_KEYS,
  PixelAvatar,
  ROLE_COLOR,
  ROLE_LABEL,
  rosterOf,
  seatsOf,
  validateAgents,
  type RosterRole,
} from "../../../lib/agents";
import { Markdown } from "../../../lib/Markdown";
import type { ChatMessage, StartRunInput } from "../../../lib/types";

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
  // 참여 좌석(role×person) 선택 — 기본은 전원. 조합이 파이프라인 모드를 정한다:
  // 기획 포함 = 계획→승인→구현, 기획 제외 = 바로 구현, 검증만 = 프로젝트 감사.
  const [selected, setSelected] = useState<Set<string>>(new Set(ALL_SEAT_KEYS));
  const threadRef = useRef<HTMLDivElement>(null);

  const rosterError = useMemo(() => validateAgents([...selected]), [selected]);
  // 선택 조합이 어떤 모드로 도는지 한 줄 예고.
  const rosterMode = useMemo(() => {
    if (rosterError) return null;
    const r = rosterOf([...selected]);
    if (!r.planner && r.builderIds.length === 0) return "🔍 검증만 — 프로젝트 현재 상태를 감사합니다 (승인·구현 없음)";
    if (r.planner && r.builderIds.length === 0) return "📋 기획만 — 계획서 작성 후 종료합니다";
    if (!r.planner) {
      return r.verifierIds.length > 0
        ? "🔨 바로 구현 — 승인 단계 없이 구현하고 선택한 검증자가 리뷰합니다"
        : "🔨 바로 구현 — 승인·검증 없이 구현 후 바로 커밋합니다 (주의)";
    }
    return r.verifierIds.length > 0 ? null : "⚠️ 검증 없이 진행 — 구현 결과를 리뷰 없이 커밋합니다";
  }, [selected, rosterError]);

  function toggleSeat(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
    const ok = await onStart({ title: derivedTitle, brief, agents: [...selected] });
    if (ok) {
      setTitle("");
      setMessages([]);
      setInput("");
      setChatError(null);
      setSelected(new Set(ALL_SEAT_KEYS));
    }
  }

  const folderName = defaultTargetDir ? defaultTargetDir.replace(/\/+$/, "").split("/").pop() : "";
  const hasChat = messages.some((m) => m.role === "user");
  // Startable as soon as there's *any* requirement text — either a sent chat
  // turn or something typed in the box — and the team combo is runnable.
  const canStart = (hasChat || !!input.trim()) && !sending && !rosterError;

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

      {/* 참여 에이전트 선택 — 조합에 따라 파이프라인 모드가 달라진다. */}
      <div>
        <b className="small">👥 참여 에이전트</b>
        {(["plan", "build", "verify"] as RosterRole[]).map((role) => (
          <div key={role} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            <span className="muted small" style={{ width: 30, flex: "0 0 auto" }}>
              {ROLE_LABEL[role]}
            </span>
            {seatsOf(role).map((seat) => {
              const a = agentById(seat.agentId);
              const on = selected.has(seat.key);
              return (
                <button
                  type="button"
                  key={seat.key}
                  className="badge"
                  onClick={() => toggleSeat(seat.key)}
                  title={`${a.name} · ${role === "verify" ? a.roleLabel : ROLE_LABEL[role]} — ${on ? "참여 중, 눌러서 제외" : "제외됨, 눌러서 참여"}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    cursor: "pointer",
                    background: "transparent",
                    borderColor: on ? ROLE_COLOR[role] : "var(--border)",
                    color: on ? ROLE_COLOR[role] : "var(--muted)",
                    opacity: on ? 1 : 0.5,
                  }}
                >
                  <PixelAvatar agent={a} size={16} />
                  {a.name}
                  <span style={{ fontSize: 10 }}>{on ? "✓" : "＋"}</span>
                </button>
              );
            })}
          </div>
        ))}
        {rosterError && (
          <div className="small" style={{ color: "var(--red)", marginTop: 6 }}>
            {rosterError}
          </div>
        )}
        {rosterMode && !rosterError && (
          <div className="muted small" style={{ marginTop: 6 }}>
            {rosterMode}
          </div>
        )}
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
        ▶ 이 팀으로 시작
      </button>
      {!canStart && !rosterError && (
        <div className="muted small" style={{ marginTop: 6 }}>
          요구사항을 적어주세요. (Opus와 대화로 다듬어도 되고, 바로 시작해도 됩니다)
        </div>
      )}
    </div>
  );
}
