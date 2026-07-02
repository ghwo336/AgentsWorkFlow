"use client";

import { useEffect, useRef, useState } from "react";
import { agentById, PixelAvatar, ROLE_COLOR } from "../../../lib/agents";
import { Markdown } from "../../../lib/Markdown";
import { useBusyAction } from "../../../lib/useBusyAction";
import type { ChatMessage } from "../../../lib/types";

// Intervention gate: shown when a step is stuck (needs_input) — after the
// builders' retries AND 호재's escalation both failed. Instead of deciding blind,
// the user can talk it through with 호재(Opus) first, then decide: give fix
// guidance (re-runs the step), accept as-is, skip, or stop.
export function InterventionPanel({
  reason,
  onChat,
  onGuide,
  onCommit,
  onSkip,
  onAbort,
}: {
  reason?: string | null;
  onChat: (messages: ChatMessage[]) => Promise<string>;
  onGuide: (feedback: string) => void | Promise<void>;
  onCommit: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  onAbort: () => void | Promise<void>;
}) {
  const [feedback, setFeedback] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const { busy, run } = useBusyAction<"guide" | "commit" | "skip" | "abort">();
  const hojae = agentById("hojae");
  const threadRef = useRef<HTMLDivElement>(null);

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
    setChatErr(null);
    try {
      const reply = await onChat(next);
      setMessages([...next, { role: "assistant", content: reply || "(응답이 비어 있습니다)" }]);
    } catch (err) {
      setChatErr(err instanceof Error ? err.message : "호재와 대화 실패");
    } finally {
      setSending(false);
    }
  }

  const lastReply = [...messages].reverse().find((m) => m.role === "assistant")?.content;

  return (
    <div className="panel" style={{ borderColor: "var(--yellow)" }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <PixelAvatar agent={hojae} size={28} />
        <b>🚧 막힌 단계 — 호재와 상의해서 결정하세요</b>
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>
        태경·민재가 여러 번 시도하고 <b style={{ color: ROLE_COLOR.plan }}>호재</b>가 개입했지만 이 단계가
        검증을 통과하지 못했습니다. 아래에서 <b>호재와 대화</b>하며 원인·방향을 정한 뒤 결정하세요.
      </div>
      {reason && (
        <div className="plan-preview" style={{ marginTop: 10 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>마지막 검증 사유</div>
          <Markdown>{reason}</Markdown>
        </div>
      )}

      {/* ── 호재와 대화 ───────────────────────────────────────────── */}
      <div className="chat-thread" ref={threadRef} style={{ marginTop: 12 }}>
        {messages.length === 0 && !sending && (
          <div className="muted small chat-empty">
            호재에게 물어보세요. 예: “왜 계속 막히는 거야?”, “peer-dep 충돌 어떻게 푸는 게 나아?”
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>
            <span className="chat-who">{m.role === "user" ? "나" : "호재"}</span>
            <div className="chat-bubble">
              {m.role === "assistant" ? <Markdown>{m.content}</Markdown> : m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="chat-msg chat-assistant">
            <span className="chat-who">호재</span>
            <div className="chat-bubble muted">…생각 중</div>
          </div>
        )}
      </div>
      {chatErr && (
        <div className="small" style={{ color: "var(--red)", marginTop: 6 }}>{chatErr}</div>
      )}
      <div style={{ marginTop: 8 }}>
        <textarea
          placeholder="호재에게 물어보기…  (Enter 전송 · Shift+Enter 줄바꿈)"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="row" style={{ marginTop: 6, gap: 8 }}>
          <button type="button" className="ghost" onClick={send} disabled={!input.trim() || sending}>
            {sending ? "전송 중…" : "💬 호재에게 보내기"}
          </button>
        </div>
      </div>

      <div style={{ height: 12, borderBottom: "1px solid var(--border)", marginBottom: 12 }} />

      {/* ── 결정 ─────────────────────────────────────────────────── */}
      <div className="muted small" style={{ marginBottom: 6 }}>
        방향을 정했으면 <b>지침</b>을 적고 다시 시도하세요 (가장 권장):
      </div>
      <textarea
        rows={3}
        placeholder="예: prisma를 6.x로 낮춰서 @auth/prisma-adapter와 맞춰줘 / next는 15.3.4 정확히 써"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        disabled={!!busy}
      />
      {lastReply && (
        <div className="row" style={{ marginTop: 6 }}>
          <button
            type="button"
            className="ghost small"
            style={{ boxShadow: "none", padding: "2px 8px" }}
            disabled={!!busy}
            onClick={() => setFeedback((f) => (f.trim() ? `${f}\n\n${lastReply}` : lastReply))}
          >
            ⤵ 호재의 마지막 제안을 지침에 넣기
          </button>
        </div>
      )}
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
  );
}
