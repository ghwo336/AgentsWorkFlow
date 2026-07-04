"use client";

import { useEffect, useState } from "react";
import {
  CAST,
  PixelAvatar,
  ROLE_COLOR,
  ROLE_LABEL,
  SEATS,
  agentById,
  type Agent,
  type Role,
} from "../lib/agents";
import { api, type LearningProposal } from "../lib/api";
import { errMsg } from "../lib/err";
import { Markdown } from "../lib/Markdown";

// 팀 소개 — the home page's "우리 팀" tab. Everyone from the CAST as clickable
// cards (grouped 기획/개발/검증); clicking opens a modal with that teammate's
// details and their REAL harness (agents-config/<id>.md) — the same text the
// pipeline injects into their prompt, so the intro can never drift from how
// they actually work.

// What a person is in charge of, from their SEATS rows (전문 분야 for devs,
// reviewer lenses for verifiers). 주호처럼 좌석이 여러 개면 전부 잇는다.
function chargeOf(agent: Agent): string {
  const seats = SEATS.filter((s) => s.agentId === agent.id);
  const parts = seats.map((s) => {
    if (s.specialty) return s.specialty;
    if (s.reviewerNames?.length) {
      const lenses = s.reviewerNames.filter((n) => n !== "tests").join("·");
      return `${lenses} 검증`;
    }
    return ROLE_LABEL[s.role];
  });
  return parts.join(" · ") || agent.roleLabel;
}

type Learned = { projects: Record<string, string>; agents: Record<string, string> };

export function TeamIntro() {
  // Harnesses load once for the whole tab (they're a handful of small md files).
  const [harnesses, setHarnesses] = useState<Record<string, string> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 팀 학습 노트(배운 것) + 제안함 — 하네스와 같은 파일-원문 표시 방식.
  const [learned, setLearned] = useState<Learned | null>(null);
  const [proposals, setProposals] = useState<LearningProposal[]>([]);

  useEffect(() => {
    api
      .agentHarnesses()
      .then(setHarnesses)
      .catch((err) => setLoadError(errMsg(err, "하네스 로드 실패")));
    api.agentLearned().then(setLearned).catch(() => {}); // 학습 노트 없음 = 빈 표시
    api.learningProposals().then(setProposals).catch(() => {});
  }, []);

  const groups: { role: Role; members: Agent[] }[] = (
    ["plan", "build", "verify", "research"] as const
  ).map((role) => ({ role, members: CAST.filter((a) => a.role === role) }));

  return (
    <div className="panel">
      <b className="pixel">👋 팀 소개</b>
      <div className="muted small" style={{ margin: "8px 0 14px" }}>
        카드를 누르면 그 팀원의 세부 정보와 개인 하네스(일하는 규칙), 배운 교훈을 볼 수 있어요.
      </div>
      {proposals.length > 0 && (
        <ProposalInbox
          proposals={proposals}
          onResolved={() => api.learningProposals().then(setProposals).catch(() => {})}
        />
      )}
      {groups.map((g) => (
        <div key={g.role} style={{ marginBottom: 16 }}>
          <div className="roster-role" style={{ color: ROLE_COLOR[g.role] }}>
            {ROLE_LABEL[g.role]}
          </div>
          <div className="intro-grid">
            {g.members.map((a) => (
              <button
                key={a.id}
                type="button"
                className="intro-card"
                onClick={() => setSelectedId(a.id)}
              >
                <PixelAvatar agent={a} size={48} />
                <div style={{ minWidth: 0, textAlign: "left" }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="pixel intro-name">{a.name}</span>
                    <span className="intro-engine">{a.engineLabel}</span>
                  </div>
                  <div className="muted small" style={{ marginTop: 2 }}>
                    {chargeOf(a)}
                  </div>
                  <div className="small intro-blurb">{a.blurb}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {learned && Object.keys(learned.projects).length > 0 && (
        <ProjectNotes projects={learned.projects} />
      )}
      {selectedId && (
        <AgentModal
          agent={agentById(selectedId)}
          harness={harnesses?.[selectedId]}
          learned={learned?.agents?.[selectedId]}
          harnessLoading={harnesses === null && !loadError}
          loadError={loadError}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// 제안함 — 회고/리서처가 올린 에이전트 교훈 후보. 승인해야만 그 팀원의 학습
// 파일(learned/agents/<id>.md)에 들어가 프롬프트에 주입된다 — 계획 승인
// 게이트의 학습판.
function ProposalInbox({
  proposals,
  onResolved,
}: {
  proposals: LearningProposal[];
  onResolved: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, action: "approve" | "reject") {
    if (busyId) return;
    setBusyId(id);
    try {
      await api.resolveProposal(id, action);
      onResolved();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="pixel small" style={{ marginBottom: 6 }}>
        📬 교훈 제안함 <span className="muted">— 승인해야 팀원이 기억합니다</span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {proposals.map((p) => {
          const who = agentById(p.agentId);
          return (
            <div
              key={p.id}
              className="row spread"
              style={{
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <div className="row" style={{ gap: 10, minWidth: 0, alignItems: "flex-start" }}>
                <PixelAvatar agent={who} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div className="small">
                    <span className="pixel">{who.name}</span>
                    <span className="muted"> · {p.project}</span>
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>
                    <b>[{p.condition}]</b> {p.lesson}
                  </div>
                  <div className="muted small" style={{ marginTop: 2 }}>
                    근거: {p.evidence}
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => decide(p.id, "approve")}
                >
                  {busyId === p.id ? "…" : "승인"}
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busyId !== null}
                  onClick={() => decide(p.id, "reject")}
                >
                  거절
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 프로젝트별 팀 학습 노트 — 회고가 자동으로 쌓는 운영 사실. 파일 원문 그대로
// (learned/projects/<project>.md) 접이식으로 보여준다.
function ProjectNotes({ projects }: { projects: Record<string, string> }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div className="pixel small" style={{ marginBottom: 6 }}>
        🧠 프로젝트 학습 노트 <span className="muted">— run이 끝날 때마다 회고가 자동으로 쌓아요</span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {Object.entries(projects).map(([name, md]) => (
          <details key={name} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
            <summary className="small" style={{ cursor: "pointer" }}>
              <b>{name}</b>
            </summary>
            <Markdown className="modal-harness-body">{md}</Markdown>
          </details>
        ))}
      </div>
    </div>
  );
}

function AgentModal({
  agent,
  harness,
  learned,
  harnessLoading,
  loadError,
  onClose,
}: {
  agent: Agent;
  harness: string | undefined;
  learned: string | undefined; // 승인된 교훈 (learned/agents/<id>.md 원문)
  harnessLoading: boolean;
  loadError: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${agent.name} 소개`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row spread" style={{ alignItems: "flex-start" }}>
          <div className="row" style={{ gap: 14 }}>
            <PixelAvatar agent={agent} size={72} />
            <div>
              <div className="pixel" style={{ fontSize: 18 }}>
                {agent.name}
              </div>
              <div className="small" style={{ color: ROLE_COLOR[agent.role], marginTop: 4 }}>
                {ROLE_LABEL[agent.role]} · {chargeOf(agent)}
              </div>
              <div className="muted small" style={{ marginTop: 2 }}>
                엔진: {agent.engineLabel}
              </div>
            </div>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div style={{ margin: "12px 0" }}>{agent.blurb}</div>

        <div className="modal-harness">
          <div className="pixel small" style={{ marginBottom: 6 }}>
            📜 개인 하네스 <span className="muted">— agents-config/{agent.id}.md</span>
          </div>
          {harnessLoading && <div className="muted small">하네스 불러오는 중…</div>}
          {loadError && (
            <div className="small" style={{ color: "var(--red)" }}>
              {loadError}
            </div>
          )}
          {!harnessLoading && !loadError && (
            harness ? (
              <Markdown className="modal-harness-body">{harness}</Markdown>
            ) : (
              <div className="muted small">
                개인 하네스 파일이 없어요 — 공용 역할 프롬프트로 일해요.
              </div>
            )
          )}
        </div>

        <div className="modal-harness" style={{ marginTop: 12 }}>
          <div className="pixel small" style={{ marginBottom: 6 }}>
            🧠 배운 교훈 <span className="muted">— learned/agents/{agent.id}.md</span>
          </div>
          {learned ? (
            <Markdown className="modal-harness-body">{learned}</Markdown>
          ) : (
            <div className="muted small">
              아직 승인된 교훈이 없어요 — 제안함에서 승인하면 여기 쌓이고, 작업 프롬프트에 주입돼요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
