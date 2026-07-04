"use client";

import { useCallback, useEffect, useRef } from "react";
import { agentForChat, PixelAvatar, ROLE_COLOR } from "../../../lib/agents";
import { api, CHAT_PAGE } from "../../../lib/api";
import { Markdown } from "../../../lib/Markdown";
import { usePagedRows } from "../../../lib/hooks/usePagedRows";
import type { ChatMsg } from "../../../lib/types";

// What each turn is, as a short tag next to the speaker.
const KIND_TAG: Record<string, string> = {
  build: "구현 보고",
  verify: "검증 의견",
  escalate: "리드 개입",
  guide: "지침",
  commit: "커밋",
  note: "메모",
};

const TO_LABEL: Record<string, string> = {
  build: "개발팀",
  verify: "검증팀",
  plan: "호재",
  system: "시스템",
  user: "리더",
};

// The team's conversation as they work each step: builder reports what it did,
// verifiers reply with their verdict, 호재 drops in with a fix plan on escalation,
// and the user's guidance shows up too. Reads top-to-bottom like a chat room.
// The detail payload carries only the latest CHAT_PAGE turns — older turns page
// in via the 더보기 button on top.
export function AgentChat({
  runId,
  msgs,
  total,
}: {
  runId: string;
  msgs: ChatMsg[];
  total?: number;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  const fetchOlder = useCallback((before: string) => api.olderRunChat(runId, before), [runId]);
  const { rows, more, loading, loadOlder } = usePagedRows(runId, msgs, total, fetchOlder);

  // 과거 대화를 앞에 붙인 직후엔 바닥으로 스크롤하지 않는다 (위를 읽는 중).
  const prepended = useRef(false);
  const loadOlderKeepScroll = useCallback(async () => {
    prepended.current = true;
    await loadOlder();
  }, [loadOlder]);
  useEffect(() => {
    if (prepended.current) {
      prepended.current = false;
      return;
    }
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [rows.length]);

  return (
    <div className="panel">
      <div className="row spread" style={{ marginBottom: 10 }}>
        <b>💬 에이전트 대화</b>
        <span className="muted small">{total ?? rows.length}개</span>
      </div>
      {rows.length === 0 ? (
        <div className="muted small">아직 대화가 없습니다. 구현이 시작되면 팀이 여기서 의견을 주고받아요.</div>
      ) : (
        <div className="agent-chat">
          {more > 0 && (
            <button
              className="ghost small"
              style={{ boxShadow: "none", padding: "2px 8px", alignSelf: "center" }}
              disabled={loading}
              onClick={loadOlderKeepScroll}
            >
              {loading ? "불러오는 중…" : `▴ 이전 대화 ${Math.min(CHAT_PAGE, more)}개 더보기 (${more}개 남음)`}
            </button>
          )}
          {rows.map((m, i) => {
            const agent = agentForChat(m);
            const prev = rows[i - 1];
            const showStep = m.stepLabel && m.stepLabel !== prev?.stepLabel;
            const verifyFail = m.kind === "verify" && m.passed === false;
            const verifyPass = m.kind === "verify" && m.passed === true;
            const tone =
              verifyFail ? "chat-fail" : verifyPass ? "chat-pass" : m.kind === "escalate" ? "chat-lead" : m.kind === "guide" ? "chat-guide" : "";
            return (
              <div key={m.id}>
                {showStep && <div className="chat-step-sep">{m.stepLabel}</div>}
                <div className={`chat-turn ${tone}`}>
                  <div className="chat-turn-avatar">
                    <PixelAvatar agent={agent} size={30} active={m.kind === "escalate"} />
                  </div>
                  <div className="chat-turn-body">
                    <div className="chat-turn-head">
                      <b style={{ color: ROLE_COLOR[agent.role] }}>{agent.name}</b>
                      <span className="chat-kind">{KIND_TAG[m.kind] ?? m.kind}</span>
                      {m.toRole && TO_LABEL[m.toRole] && (
                        <span className="muted small">→ {TO_LABEL[m.toRole]}</span>
                      )}
                      {verifyFail && <span className="chat-verdict fail">거절</span>}
                      {verifyPass && <span className="chat-verdict pass">통과</span>}
                    </div>
                    <div className="chat-turn-text">
                      <Markdown>{m.text}</Markdown>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}
