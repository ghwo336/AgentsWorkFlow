"use client";

import { useMemo, useState } from "react";
import { agentForStep, TeamRoster } from "../../../lib/agents";
import { Markdown } from "../../../lib/Markdown";
import type { Run, RunDetail } from "../../../lib/types";
import { RunViz } from "../_viz";
import { useWorkspace } from "../useWorkspace";
import { AgentChat } from "./AgentChat";
import { AgentWorkSummary } from "./AgentWorkSummary";
import { ApprovalPanel } from "./ApprovalPanel";
import { FollowUpPanel } from "./FollowUpPanel";
import { InterventionPanel } from "./InterventionPanel";
import { LiveLog } from "./LiveLog";
import { NewTaskForm } from "./NewTaskForm";
import { ProjectSettings } from "./ProjectSettings";
import { ResumePanel } from "./ResumePanel";
import { RunDetailCard, RunList } from "./RunList";
import { RunProgress } from "./RunProgress";

type WsTab = "overview" | "plan" | "work" | "log";

// The workspace UI, split into tabs so one screen never carries everything:
// 개요(팀·작업 선택) → 기획(계획 작성·승인) → 작업(진행 상황) → 로그.
// Initial data (runs + latest detail) arrives from the server component
// (page.tsx) with the HTML itself — the browser never waterfalls fetches for
// the first paint. From there useWorkspace keeps it live over SSE.
export function Workspace({
  project,
  initialRuns,
  initialDetail,
}: {
  project: string;
  initialRuns: Run[];
  initialDetail: RunDetail | null;
}) {
  const {
    runs,
    selected,
    setSelected,
    detail,
    booting,
    error,
    start,
    decide,
    revise,
    intervene,
    interveneChat,
    retry,
    defaultTargetDir,
    saveProjectDir,
    repos,
  } = useWorkspace(project, { runs: initialRuns, detail: initialDetail });

  const [tab, setTab] = useState<WsTab>("overview");

  // Who's actively working right now — the teammates behind any running step.
  // Feeds the office roster so their avatar catches fire while they work.
  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of detail?.steps ?? []) {
      if (s.status === "running") ids.add(agentForStep(s).id);
    }
    return ids;
  }, [detail?.steps]);

  // 사용자 결정이 필요한 상태 → 해당 탭에 알림 점을 찍어 어디를 봐야 하는지 알린다.
  const planAttention = detail?.status === "awaiting_approval";
  const workAttention =
    detail?.status === "needs_input" ||
    detail?.status === "failed" ||
    detail?.status === "rejected";

  const TABS: { key: WsTab; label: string; dot?: boolean }[] = [
    { key: "overview", label: "🏠 개요" },
    { key: "plan", label: "📝 기획", dot: planAttention },
    { key: "work", label: "🔨 작업", dot: workAttention },
    { key: "log", label: "📜 로그" },
  ];

  return (
    <div className="wrap">
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div>
          <a href="/" className="small">
            ← 프로젝트 목록
          </a>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>📁 {project}</div>
        </div>
        <a href={`/usage?project=${encodeURIComponent(project)}`} className="small">
          이 프로젝트 비용 보기 →
        </a>
      </div>
      {error && (
        <div className="panel small" style={{ color: "var(--red)" }}>
          {error}
        </div>
      )}

      <div className="viz-tabs ws-tabs" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`viz-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.dot && <span className="ws-tab-dot" />}
          </button>
        ))}
      </div>

      {/* ── 개요: 참여 에이전트 + 프로젝트 설정 + 작업 선택 ───────────── */}
      {tab === "overview" && (
        <>
          <TeamRoster activeIds={activeIds} />
          {booting && runs.length === 0 ? (
            <div className="panel">
              <b>작업 목록</b>
              <div style={{ height: 8 }} />
              <div className="skeleton" style={{ height: 14 }} />
              <div className="skeleton" style={{ height: 14, marginTop: 8 }} />
              <div className="skeleton" style={{ height: 14, marginTop: 8 }} />
            </div>
          ) : (
            <RunList
              runs={runs}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                // 작업을 고르는 목적은 상황 확인 — 바로 작업 탭으로 데려간다.
                setTab("work");
              }}
            />
          )}
          <ProjectSettings defaultTargetDir={defaultTargetDir} repos={repos} onSave={saveProjectDir} />
        </>
      )}

      {/* ── 기획: 새 작업 시작 + 계획 승인/수정 + 현재 기획 전문 ─────── */}
      {tab === "plan" && (
        <>
          {detail?.status === "awaiting_approval" && (
            <ApprovalPanel
              plan={detail.plan ?? ""}
              onApprove={(editedPlan) => decide(true, editedPlan)}
              onReject={() => decide(false)}
              onRevise={(feedback) => revise(feedback)}
            />
          )}
          {detail?.status === "committed" && (
            <FollowUpPanel baseTitle={detail.title} commit={detail.commit} onStart={start} />
          )}
          <NewTaskForm onStart={start} defaultTargetDir={defaultTargetDir} />
          {detail && detail.status !== "awaiting_approval" && detail.plan && (
            <div className="panel">
              <div className="row spread">
                <b>현재 기획</b>
                <span className="muted small">{detail.title}</span>
              </div>
              <div className="md" style={{ marginTop: 8 }}>
                <Markdown>{detail.plan}</Markdown>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── 작업: 선택한 run의 진행 상황 ─────────────────────────────── */}
      {tab === "work" && (
        <>
          {booting && !detail && (
            <>
              <div className="panel">
                <div className="skeleton" style={{ height: 18, width: "40%" }} />
                <div className="skeleton" style={{ height: 12, width: "70%", marginTop: 10 }} />
                <div className="skeleton" style={{ height: 12, width: "55%", marginTop: 6 }} />
              </div>
              <div className="panel">
                <div className="skeleton" style={{ height: 14, width: "25%" }} />
                <div className="skeleton" style={{ height: 44, marginTop: 10 }} />
                <div className="skeleton" style={{ height: 44, marginTop: 8 }} />
                <div className="skeleton" style={{ height: 44, marginTop: 8 }} />
              </div>
            </>
          )}
          {!booting && !detail && (
            <div className="panel muted">
              개요 탭에서 작업을 선택하거나, 기획 탭에서 새 작업을 시작하세요.
            </div>
          )}
          {detail && (
            <>
              <RunDetailCard detail={detail} />
              <RunProgress detail={detail} />
              {detail.status === "awaiting_approval" && (
                <div className="panel small">
                  📝 기획 승인 대기 중입니다 —{" "}
                  <button type="button" className="ghost small" onClick={() => setTab("plan")}>
                    기획 탭에서 검토하기
                  </button>
                </div>
              )}
              {detail.status === "needs_input" && (
                <InterventionPanel
                  reason={detail.error}
                  onChat={(messages) => interveneChat(messages)}
                  onGuide={(feedback) => intervene({ action: "guide", feedback })}
                  onCommit={() => intervene({ action: "commit" })}
                  onSkip={() => intervene({ action: "skip" })}
                  onAbort={() => intervene({ action: "abort" })}
                />
              )}
              {(detail.status === "rejected" || detail.status === "failed") && (
                <ResumePanel reason={detail.error} onRetry={() => retry()} />
              )}
              <AgentWorkSummary
                steps={detail.steps}
                status={detail.status}
                plan={detail.plan ?? undefined}
              />
              <RunViz steps={detail.steps} status={detail.status} />
            </>
          )}
        </>
      )}

      {/* ── 로그: 에이전트 대화 + 라이브 로그 ────────────────────────── */}
      {tab === "log" &&
        (detail ? (
          <>
            <AgentChat runId={detail.id} msgs={detail.chatMsgs ?? []} total={detail.chatTotal} />
            <LiveLog runId={detail.id} events={detail.events} total={detail.eventsTotal} />
          </>
        ) : (
          <div className="panel muted">작업을 선택하면 로그가 표시됩니다.</div>
        ))}
    </div>
  );
}
