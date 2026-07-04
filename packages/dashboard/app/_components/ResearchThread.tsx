"use client";

import { useState } from "react";
import { agentById, PixelAvatar, ROLE_COLOR } from "../lib/agents";
import { api } from "../lib/api";
import { errMsg } from "../lib/err";
import { Markdown } from "../lib/Markdown";
import { isRunning, statusLabel, WEB_RESEARCHER, X_RESEARCHER } from "../lib/research";
import { useLoad } from "../lib/hooks/useLoad";
import type { ResearchFolder } from "../lib/types";
import { RESEARCHERS, ResearcherPicker, toSeats } from "./ResearcherPicker";

// 리서치 스레드 하나 — 대화(질문↔보고서) + 후속 질문 입력 + 폴더 이동.
// 첫 말풍선은 run.brief(최초 질문), 이후는 팀 채팅의 user/research 턴.
export function ResearchThread({
  id,
  refreshKey,
  folders,
  onMoved,
}: {
  id: string;
  refreshKey: number;
  folders: ResearchFolder[];
  onMoved: (folderId: string | null) => void; // 이동 후 부모가 그 폴더로 따라간다
}) {
  // resetKey=id: 탭 전환 시 이전 스레드가 잠깐 비치지 않도록 즉시 비운다.
  // 로드 실패는 조용히 넘긴다 — 다음 refresh에서 재시도.
  const { data: detail, reload } = useLoad(() => api.getResearchRun(id), [id, refreshKey], {
    resetKey: id,
  });
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 이 후속 질문을 누구에게 물을지 — 기본 둘 다, 매번 바꿀 수 있다.
  const [picked, setPicked] = useState<string[]>([...RESEARCHERS]);

  if (!detail) return <div className="panel muted small">스레드 불러오는 중…</div>;

  const running = isRunning(detail.status);
  const turns = detail.chatMsgs.filter((m) => m.role === "user" || m.role === "research");
  // 채팅 기록이 없는 옛 run(스레드 도입 전) 호환: 보고서는 Run.plan에만 있다.
  // 그 시절 리서치는 전부 Claude 리서처(현 예림)의 작업이다.
  const legacyReport = !running && !turns.some((m) => m.role === "research") ? detail.plan : null;
  const lastEvents = detail.events.slice(-5);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || sending || running || picked.length === 0) return;
    setSending(true);
    try {
      await api.researchFollowUp(id, q, toSeats(picked));
      setQuestion("");
      setError(null);
      await reload();
    } catch (err) {
      setError(errMsg(err, "후속 질문 전송 실패"));
    } finally {
      setSending(false);
    }
  }

  async function moveToFolder(folderId: string | null) {
    if (moving) return;
    setMoving(true);
    try {
      await api.setRunFolder(id, folderId);
      setError(null);
      await reload();
      onMoved(folderId);
    } catch (err) {
      setError(errMsg(err, "폴더 이동 실패"));
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="panel">
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <b className="agent-chip">
          <PixelAvatar agent={agentById(X_RESEARCHER)} size={22} active={running} />
          <PixelAvatar agent={agentById(WEB_RESEARCHER)} size={22} active={running} />
          <span style={{ color: ROLE_COLOR.research }}>{detail.title}</span>
        </b>
        <span className="row" style={{ gap: 8, alignItems: "center" }}>
          <select
            value={detail.folderId ?? ""}
            disabled={moving}
            onChange={(e) => moveToFolder(e.target.value || null)}
            title="이 리서치를 담을 폴더"
          >
            <option value="">📂 미분류</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                📁 {f.name}
              </option>
            ))}
          </select>
          <span className={`badge b-${detail.status}`}>{statusLabel(detail.status)}</span>
        </span>
      </div>

      {/* 보고서가 길다 — 공용 chat-thread의 280px 상한을 스레드용으로 늘린다 */}
      <div className="chat-thread" style={{ marginTop: 12, maxHeight: "62vh" }}>
        <ThreadBubble agentId={null} text={detail.brief ?? ""} />
        {turns.map((m) =>
          m.text ? (
            <ThreadBubble
              key={m.id}
              agentId={m.role === "user" ? null : (m.agent ?? WEB_RESEARCHER)}
              text={m.text}
            />
          ) : null
        )}
        {legacyReport && <ThreadBubble agentId={WEB_RESEARCHER} text={legacyReport} />}
        {running && (
          <div className="chat-msg chat-assistant">
            <span className="chat-who">리서치팀</span>
            <div className="chat-bubble">
              <div className="small">
                🔎 상현(X)·예림(웹)이 조사 중… 완료되는 대로 보고서가 하나씩 나타나요.
              </div>
              <div className="log" style={{ marginTop: 8 }}>
                {lastEvents.map((ev) => (
                  <div key={ev.id} className="line">
                    <span className={`msg${ev.level === "error" ? " err" : ev.level === "warn" ? " warn" : ""}`}>
                      {ev.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {detail.error && (
        <div className="small" style={{ color: "var(--red)", marginTop: 8, whiteSpace: "pre-wrap" }}>
          {detail.error}
        </div>
      )}
      {error && (
        <div className="small" style={{ color: "var(--red)", marginTop: 8 }}>
          {error}
        </div>
      )}

      {!running && (
        <form onSubmit={submit} style={{ marginTop: 12 }}>
          {/* 이 후속 질문을 누구에게 물을지 — 매 질문마다 고를 수 있다. */}
          <ResearcherPicker picked={picked} onChange={setPicked} size={22} />
          <div style={{ height: 8 }} />
          <textarea
            placeholder={
              detail.status === "failed"
                ? "조사가 실패했어요 — 질문을 다시 보내면 이어서 시도해요."
                : "후속 질문을 이어서 물어보세요 — 위 대화를 기억한 채로 답해요."
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            style={{ width: "100%", resize: "vertical" }}
          />
          <div style={{ height: 8 }} />
          <button type="submit" disabled={sending || !question.trim()}>
            {sending ? "보내는 중…" : "후속 질문 →"}
          </button>
        </form>
      )}
    </div>
  );
}

// agentId = null → 사용자 말풍선, 그 외 → 해당 리서처(상현/예림)의 말풍선.
function ThreadBubble({ agentId, text }: { agentId: string | null; text: string }) {
  const mine = agentId === null;
  const who = mine ? null : agentById(agentId);
  return (
    <div className={`chat-msg ${mine ? "chat-user" : "chat-assistant"}`}>
      <span className="chat-who">
        {mine || !who ? (
          "나"
        ) : (
          <span className="row" style={{ gap: 4, alignItems: "center" }}>
            <PixelAvatar agent={who} size={16} /> {who.name} · {who.roleLabel}
          </span>
        )}
      </span>
      <div className="chat-bubble">
        <Markdown className="md">{text}</Markdown>
      </div>
    </div>
  );
}
