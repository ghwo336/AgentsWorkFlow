"use client";

import { useEffect, useRef } from "react";
import { agentForChat, PixelAvatar, ROLE_COLOR } from "../../../lib/agents";
import { Markdown } from "../../../lib/Markdown";
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
export function AgentChat({ msgs }: { msgs: ChatMsg[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [msgs.length]);

  return (
    <div className="panel">
      <div className="row spread" style={{ marginBottom: 10 }}>
        <b>💬 에이전트 대화</b>
        <span className="muted small">{msgs.length}개</span>
      </div>
      {msgs.length === 0 ? (
        <div className="muted small">아직 대화가 없습니다. 구현이 시작되면 팀이 여기서 의견을 주고받아요.</div>
      ) : (
        <div className="agent-chat">
          {msgs.map((m, i) => {
            const agent = agentForChat(m);
            const prev = msgs[i - 1];
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
