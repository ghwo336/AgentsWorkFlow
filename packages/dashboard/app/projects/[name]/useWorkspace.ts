"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useOrchestratorEvents } from "../../lib/useOrchestratorEvents";
import type { InterventionDecision, Run, RunDetail, StartRunInput } from "../../lib/types";

// Container logic for one project's workspace: owns the run list + selected
// detail, keeps them live over SSE, and exposes the start/decide actions.
// The page and presentational components stay free of fetching/state wiring.
export function useWorkspace(project: string) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultTargetDir, setDefaultTargetDir] = useState<string>("");
  const [repos, setRepos] = useState<string[]>([]);

  const selectedRef = useRef<string | null>(null);
  const runIdsRef = useRef<Set<string>>(new Set());

  // Errors from orchestrator actions add a hint to check the connection.
  const fail = useCallback((err: unknown, fallback: string, hint = false) => {
    const base = err instanceof Error ? err.message : fallback;
    setError(hint ? `${base} - dashboard 서버의 orchestrator 연결을 확인하세요.` : base);
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const data = await api.listRuns(project);
      setRuns(data);
      runIdsRef.current = new Set(data.map((d) => d.id));
      setSelected((cur) => cur ?? data[0]?.id ?? null);
      setError(null);
    } catch (err) {
      fail(err, "작업 목록 로드 실패");
    }
  }, [project, fail]);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        setDetail(await api.getRun(id));
        setError(null);
      } catch (err) {
        fail(err, "작업 상세 로드 실패");
      }
    },
    [fail]
  );

  // The project's remembered default repo dir (best-effort; a project without a
  // row yet just has no default).
  const loadProject = useCallback(async () => {
    try {
      const p = await api.getProject(project);
      setDefaultTargetDir(p.defaultTargetDir ?? "");
    } catch {
      setDefaultTargetDir("");
    }
  }, [project]);

  const saveProjectDir = useCallback(
    async (dir: string) => {
      try {
        const p = await api.setProjectDir(project, dir);
        setDefaultTargetDir(p.defaultTargetDir ?? "");
        setError(null);
      } catch (err) {
        fail(err, "기본 저장소 저장 실패");
      }
    },
    [project, fail]
  );

  useEffect(() => {
    loadRuns();
    loadProject();
  }, [loadRuns, loadProject]);

  // Git repos on the server, for the picker (global — not project-specific).
  useEffect(() => {
    api.listRepos().then(setRepos).catch(() => setRepos([]));
  }, []);

  useEffect(() => {
    if (selected) loadDetail(selected);
  }, [selected, loadDetail]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Live updates — only react to events for runs in THIS project.
  const onEvent = useCallback(
    (m: MessageEvent) => {
      try {
        const e = JSON.parse(m.data);
        if (!e.runId) return;
        // New run we don't know about yet → refresh the list to catch it.
        if (!runIdsRef.current.has(e.runId)) {
          loadRuns();
          return;
        }
        loadRuns();
        if (e.runId === selectedRef.current) loadDetail(e.runId);
      } catch {}
    },
    [loadRuns, loadDetail]
  );
  useOrchestratorEvents(onEvent);

  const start = useCallback(
    async (input: StartRunInput): Promise<boolean> => {
      try {
        const { id } = await api.startRun({ ...input, project });
        setSelected(id);
        setError(null);
        loadRuns();
        return true;
      } catch (err) {
        fail(err, "orchestrator 작업 시작 실패", true);
        return false;
      }
    },
    [project, loadRuns, fail]
  );

  const decide = useCallback(
    async (approved: boolean, editedPlan?: string) => {
      if (!detail) return;
      try {
        if (approved) await api.approve(detail.id, editedPlan);
        else await api.reject(detail.id);
        setError(null);
        loadDetail(detail.id);
      } catch (err) {
        fail(err, "승인/거절 요청 실패", true);
      }
    },
    [detail, loadDetail, fail]
  );

  // Send feedback to re-plan (interactive refinement). The plan updates over SSE.
  const revise = useCallback(
    async (feedback: string) => {
      if (!detail) return;
      try {
        await api.revise(detail.id, feedback);
        setError(null);
        loadDetail(detail.id);
      } catch (err) {
        fail(err, "수정 요청 실패", true);
      }
    },
    [detail, loadDetail, fail]
  );

  // Resolve a run stuck at needs_input (guide/commit/skip/abort).
  const intervene = useCallback(
    async (decision: InterventionDecision) => {
      if (!detail) return;
      try {
        await api.resume(detail.id, decision);
        setError(null);
        loadDetail(detail.id);
      } catch (err) {
        fail(err, "재개 요청 실패", true);
      }
    },
    [detail, loadDetail, fail]
  );

  return {
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
  };
}
