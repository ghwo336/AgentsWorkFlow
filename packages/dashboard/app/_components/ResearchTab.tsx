"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { agentById, PixelAvatar, RESEARCH_PROJECT, ROLE_COLOR } from "../lib/agents";
import { api } from "../lib/api";
import { Markdown } from "../lib/Markdown";
import type { Run, RunDetail } from "../lib/types";

// 홈의 🔍 리서치 탭 — 리서치 하나가 "탭 하나 = 대화 스레드 하나"다. 질문을
// 제출하면 리서치 팀 run이 생기고 — 상현(Grok)이 X를, 예림(Claude)이 웹을
// 동시에 조사해 보고서 두 개가 나란히 온다 — 보고서가 나온 뒤에도(reported)
// 같은 탭에서 후속 질문을 이어갈 수 있다. 스레드 본문은 run의 팀 채팅
// (user 질문 ↔ research 보고서, 화자는 msg.agent)으로 그린다.

const X_RESEARCHER = "sanghyun"; // 상현 (Grok — X 실시간)
const WEB_RESEARCHER = "yerim"; // 예림 (Claude — 웹 전반)
const RESEARCH_SEATS = [`research:${X_RESEARCHER}`, `research:${WEB_RESEARCHER}`];

// 리서치 화면용 상태 라벨 — 코드 파이프라인 어휘(committed)를 그대로 노출하지
// 않는다. committed는 reported 도입 전의 리서치 run (하위 호환).
const STATUS_LABEL: Record<string, string> = {
  reported: "완료",
  committed: "완료",
  researching: "조사 중",
  planning: "준비 중",
  failed: "실패",
};
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
const isRunning = (s: string) => s === "researching" || s === "planning";

// refreshKey: 부모(HomeClient)가 SSE 이벤트마다 올려주는 카운터 — 값이 바뀔
// 때마다 목록과 열려 있는 스레드를 다시 읽는다 (EventSource는 부모 것 하나만 사용).
export function ResearchTab({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  // null = "＋ 새 리서치" 탭.
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.listRuns(RESEARCH_PROJECT);
      setRuns(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "리서치 목록 로드 실패");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <>
      <div className="viz-tabs" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className={`viz-tab${activeId === null ? " active" : ""}`}
          onClick={() => setActiveId(null)}
        >
          ＋ 새 리서치
        </button>
        {runs.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`viz-tab${activeId === r.id ? " active" : ""}`}
            onClick={() => setActiveId(r.id)}
            title={r.title}
          >
            {isRunning(r.status) ? "🔎 " : ""}
            {r.title.length > 18 ? `${r.title.slice(0, 18)}…` : r.title}
          </button>
        ))}
      </div>

      {error && (
        <div className="small" style={{ color: "var(--red)", marginBottom: 10 }}>
          {error}
        </div>
      )}

      {activeId === null ? (
        <NewResearchForm
          onStarted={(id) => {
            setActiveId(id);
            load();
          }}
        />
      ) : (
        <ResearchThread id={activeId} refreshKey={refreshKey} />
      )}
    </>
  );
}

function NewResearchForm({ onStarted }: { onStarted: (id: string) => void }) {
  const [question, setQuestion] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || starting) return;
    setStarting(true);
    try {
      const title = q.length > 60 ? `${q.slice(0, 60)}…` : q;
      const { id } = await api.startRun({
        project: RESEARCH_PROJECT,
        title,
        brief: q,
        agents: RESEARCH_SEATS,
      });
      setQuestion("");
      onStarted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "리서치 시작 실패");
    } finally {
      setStarting(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <PixelAvatar agent={agentById(X_RESEARCHER)} size={40} />
        <PixelAvatar agent={agentById(WEB_RESEARCHER)} size={40} />
        <div>
          <b className="pixel">🔍 새 리서치</b>
          <div className="muted small" style={{ marginTop: 2 }}>
            상현(X 실시간)과 예림(웹 전반)이 동시에 조사해서 보고서 두 개로 답해요. 보고서가 나온
            뒤에도 같은 탭에서 계속 물어볼 수 있어요.
          </div>
        </div>
      </div>
      <div style={{ height: 10 }} />
      <textarea
        placeholder="궁금한 것을 물어보세요 (예: 2026년 기준 Next.js와 Remix 중 무엇을 쓰는 게 좋을까? 근거와 함께)"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        style={{ width: "100%", resize: "vertical" }}
      />
      <div style={{ height: 8 }} />
      <button type="submit" disabled={starting || !question.trim()}>
        {starting ? "시작하는 중…" : "조사 시작 →"}
      </button>
    </form>
  );
}

// 리서치 스레드 하나 — 대화(질문↔보고서) + 후속 질문 입력. 첫 말풍선은
// run.brief(최초 질문), 이후는 팀 채팅의 user/research 턴.
function ResearchThread({ id, refreshKey }: { id: string; refreshKey: number }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 탭 전환 시 이전 스레드가 잠깐 비치지 않도록 id가 바뀌면 즉시 비운다.
  const shownId = useRef(id);
  if (shownId.current !== id) {
    shownId.current = id;
    if (detail) setDetail(null);
  }

  const load = useCallback(async () => {
    try {
      setDetail(await api.getResearchRun(id));
    } catch {
      /* 다음 refresh에서 재시도 */
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

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
    if (!q || sending || running) return;
    setSending(true);
    try {
      await api.researchFollowUp(id, q);
      setQuestion("");
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "후속 질문 전송 실패");
    } finally {
      setSending(false);
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
        <span className={`badge b-${detail.status}`}>{statusLabel(detail.status)}</span>
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
                    <span className={ev.level === "error" ? "err" : ev.level === "warn" ? "warn" : ""}>
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
          <textarea
            placeholder={
              detail.status === "failed"
                ? "조사가 실패했어요 — 질문을 다시 보내면 이어서 시도해요."
                : "후속 질문을 이어서 물어보세요 — 상현·예림이 위 대화를 기억한 채로 답해요."
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
