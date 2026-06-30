"use client";

import { useParams } from "next/navigation";
import {
  ApprovalPanel,
  LiveLog,
  NewTaskForm,
  RunDetailCard,
  RunList,
} from "./_components";
import { useWorkspace } from "./useWorkspace";

export default function ProjectWorkspace() {
  const params = useParams<{ name: string }>();
  const project = decodeURIComponent(params.name);
  const { runs, selected, setSelected, detail, error, start, decide } = useWorkspace(project);

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
          <NewTaskForm onStart={start} />
          <RunList runs={runs} selected={selected} onSelect={setSelected} />
        </div>

        {/* Right: selected run detail + log */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!detail && <div className="panel muted">작업을 선택하거나 새로 시작하세요.</div>}
          {detail && (
            <>
              <RunDetailCard detail={detail} />
              {detail.status === "awaiting_approval" && (
                <ApprovalPanel
                  plan={detail.plan ?? ""}
                  onApprove={(editedPlan) => decide(true, editedPlan)}
                  onReject={() => decide(false)}
                />
              )}
              <LiveLog events={detail.events} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
