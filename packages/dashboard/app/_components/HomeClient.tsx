"use client";

import { useCallback, useState } from "react";
import { RESEARCH_PROJECT } from "../lib/agents";
import { api } from "../lib/api";
import { errMsg } from "../lib/err";
import { useLoad } from "../lib/hooks/useLoad";
import { useOrchestratorEvents } from "../lib/hooks/useOrchestratorEvents";
import type { ProjectSummary } from "../lib/types";

// 리서치 run들이 담기는 예약 프로젝트는 프로젝트 목록이 아니라 /research
// 섹션의 것이다 — 목록에서 숨긴다.
const visibleProjects = (rows: ProjectSummary[]) => rows.filter((p) => p.name !== RESEARCH_PROJECT);

// Home UI — 프로젝트 목록/생성 전용. 리서치·팀은 이제 각자 라우트(/research,
// /team)라 여기서 탭으로 다루지 않는다.
// The initial project list arrives from the server component (page.tsx) inside
// the HTML; SSE events refresh it live afterward.
export function HomeClient({ initialProjects }: { initialProjects: ProjectSummary[] }) {
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  // SSE 이벤트 카운터 — 프로젝트 목록을 다시 읽는 신호로 쓴다.
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, error } = useLoad(() => api.listProjects().then(visibleProjects), [refreshKey], {
    initial: visibleProjects(initialProjects),
    errorLabel: "프로젝트 목록 로드 실패",
  });
  const projects = data ?? [];

  // Live status refresh: any orchestrator event may change a project's state.
  useOrchestratorEvents(useCallback(() => setRefreshKey((n) => n + 1), []));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      await api.createProject(name);
    } catch (err) {
      // 생성이 실패했는데 워크스페이스로 이동하면 빈 화면에서 원인을 알 수 없다.
      setCreateError(errMsg(err, "프로젝트 생성 실패"));
      return;
    }
    setNewName("");
    // Jump straight into the new project's workspace.
    window.location.href = `/projects/${encodeURIComponent(name)}`;
  }

  return (
    <div className="wrap">
      <form className="panel" onSubmit={create}>
        <b>＋ 새 프로젝트</b>
        <div style={{ height: 8 }} />
        <div className="row" style={{ gap: 8 }}>
          <input
            placeholder="프로젝트 이름 (예: minoritygame)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" style={{ whiteSpace: "nowrap" }}>
            만들기 →
          </button>
        </div>
        {createError && (
          <div className="small" style={{ color: "var(--red)", marginTop: 8 }}>
            {createError}
          </div>
        )}
      </form>

      <div className="panel">
        <b>프로젝트</b>
        <div style={{ height: 12 }} />
        {error && (
          <div className="small" style={{ color: "var(--red)", marginBottom: 10 }}>
            {error}
          </div>
        )}
        <div style={{ display: "grid", gap: 10 }}>
          {projects.map((p) => (
            <ProjectCard key={p.name} project={p} />
          ))}
          {projects.length === 0 && (
            <span className="muted small">아직 프로젝트가 없습니다. 위에서 하나 만들어 보세요.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project: p }: { project: ProjectSummary }) {
  return (
    <a
      href={`/projects/${encodeURIComponent(p.name)}`}
      className="row spread"
      style={{
        padding: "12px 14px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        color: "var(--text)",
        textDecoration: "none",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{p.name}</div>
        <div className="muted small" style={{ marginTop: 2 }}>
          작업 {p.runCount}개
          {p.lastTitle ? ` · 최근: ${p.lastTitle}` : " · 아직 작업 없음"}
          {" · "}≈ ${p.costUsd.toFixed(p.costUsd < 1 ? 4 : 2)}
        </div>
      </div>
      {p.lastStatus && <span className={`badge b-${p.lastStatus}`}>{p.lastStatus}</span>}
    </a>
  );
}
