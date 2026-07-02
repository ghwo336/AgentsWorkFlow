"use client";

import { useParams } from "next/navigation";
import {
  AgentWorkSummary,
  ApprovalPanel,
  InterventionPanel,
  LiveLog,
  NewTaskForm,
  ProjectSettings,
  RunDetailCard,
  RunList,
  RunProgress,
} from "./_components";
import { RunViz } from "./_viz";
import { agentForStep, TeamRoster } from "../../lib/agents";
import { useWorkspace } from "./useWorkspace";
import { useMemo } from "react";

export default function ProjectWorkspace() {
  const params = useParams<{ name: string }>();
  const project = decodeURIComponent(params.name);
  const {
    runs,
    selected,
    setSelected,
    detail,
    error,
    start,
    decide,
    revise,
    intervene,
    defaultTargetDir,
    saveProjectDir,
    repos,
  } = useWorkspace(project);

  // Who's actively working right now — the teammates behind any running step.
  // Feeds the office roster so their avatar catches fire while they work.
  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of detail?.steps ?? []) {
      if (s.status === "running") ids.add(agentForStep(s).id);
    }
    return ids;
  }, [detail?.steps]);

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

      <div className="row cols" style={{ gap: 16, alignItems: "flex-start" }}>
        {/* Left: new task + runs list */}
        <div className="side" style={{ flex: "0 0 300px" }}>
          <TeamRoster activeIds={activeIds} />
          <ProjectSettings defaultTargetDir={defaultTargetDir} repos={repos} onSave={saveProjectDir} />
          <NewTaskForm onStart={start} defaultTargetDir={defaultTargetDir} />
          <RunList runs={runs} selected={selected} onSelect={setSelected} />
        </div>

        {/* Right: selected run detail + log */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!detail && <div className="panel muted">작업을 선택하거나 새로 시작하세요.</div>}
          {detail && (
            <>
              <RunDetailCard detail={detail} />
              <RunProgress detail={detail} />
              {detail.status === "awaiting_approval" && (
                <ApprovalPanel
                  plan={detail.plan ?? ""}
                  onApprove={(editedPlan) => decide(true, editedPlan)}
                  onReject={() => decide(false)}
                  onRevise={(feedback) => revise(feedback)}
                />
              )}
              {detail.status === "needs_input" && (
                <InterventionPanel
                  reason={detail.error}
                  onGuide={(feedback) => intervene({ action: "guide", feedback })}
                  onCommit={() => intervene({ action: "commit" })}
                  onSkip={() => intervene({ action: "skip" })}
                  onAbort={() => intervene({ action: "abort" })}
                />
              )}
              <AgentWorkSummary
                steps={detail.steps}
                status={detail.status}
                plan={detail.plan ?? undefined}
              />
              <RunViz steps={detail.steps} status={detail.status} />
              <LiveLog events={detail.events} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
