"use client";

import { useCallback, useEffect, useState } from "react";
import { TeamIntro } from "./_components/TeamIntro";
import { api } from "./lib/api";
import { useOrchestratorEvents } from "./lib/useOrchestratorEvents";
import type { ProjectSummary } from "./lib/types";

type HomeTab = "projects" | "team";

export default function ProjectsHome() {
  const [tab, setTab] = useState<HomeTab>("projects");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "프로젝트 목록 로드 실패");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Live status refresh: any orchestrator event may change a project's state.
  const onEvent = useCallback(() => load(), [load]);
  useOrchestratorEvents(onEvent);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await api.createProject(name).catch(() => {});
    setNewName("");
    // Jump straight into the new project's workspace.
    window.location.href = `/projects/${encodeURIComponent(name)}`;
  }

  return (
    <div className="wrap">
      <div className="viz-tabs home-tabs" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`viz-tab${tab === "projects" ? " active" : ""}`}
          onClick={() => setTab("projects")}
        >
          📁 프로젝트
        </button>
        <button
          type="button"
          className={`viz-tab${tab === "team" ? " active" : ""}`}
          onClick={() => setTab("team")}
        >
          👋 팀 소개
        </button>
      </div>

      {tab === "team" && <TeamIntro />}

      {tab === "projects" && (
        <>
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
        </>
      )}
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
