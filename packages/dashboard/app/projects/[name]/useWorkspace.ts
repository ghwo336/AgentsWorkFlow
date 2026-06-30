"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useOrchestratorEvents } from "../../lib/useOrchestratorEvents";
import type { Run, RunDetail, StartRunInput } from "../../lib/types";

// Container logic for one project's workspace: owns the run list + selected
// detail, keeps them live over SSE, and exposes the start/decide actions.
// The page and presentational components stay free of fetching/state wiring.
export function useWorkspace(project: string) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

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
        await api.decide(detail.id, approved, editedPlan);
        setError(null);
        loadDetail(detail.id);
      } catch (err) {
        fail(err, "승인/거절 요청 실패", true);
      }
    },
    [detail, loadDetail, fail]
  );

  return { runs, selected, setSelected, detail, error, start, decide };
}
