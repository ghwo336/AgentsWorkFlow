"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useOrchestratorEvents } from "../../lib/useOrchestratorEvents";
import type { ChatMessage, InterventionDecision, Run, RunDetail, StartRunInput } from "../../lib/types";

// Server-rendered first-paint data (page.tsx fetches it orchestrator-local and
// ships it with the HTML). Present = no client-side boot fetch at all.
export type WorkspaceInitial = { runs: Run[]; detail: RunDetail | null };

// Container logic for one project's workspace: owns the run list + selected
// detail, keeps them live over SSE, and exposes the start/decide actions.
// The page and presentational components stay free of fetching/state wiring.
// NOTE: `initial`은 첫 렌더에서만 읽는다 — 프로젝트가 바뀔 때는 부모가
// key=project로 리마운트해 준다.
export function useWorkspace(project: string, initial?: WorkspaceInitial) {
  const [runs, setRuns] = useState<Run[]>(initial?.runs ?? []);
  const [selected, setSelected] = useState<string | null>(initial?.detail?.id ?? null);
  const [detail, setDetail] = useState<RunDetail | null>(initial?.detail ?? null);
  // 첫 페인트: 초기 데이터 없이 마운트됐을 때만 클라이언트 부트 로드가 돌고,
  // 끝나기 전까지 페이지는 빈 상태 문구 대신 스켈레톤을 그린다.
  const [booting, setBooting] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [defaultTargetDir, setDefaultTargetDir] = useState<string>("");
  const [repos, setRepos] = useState<string[]>([]);

  const seeded = useRef(!!initial);
  const selectedRef = useRef<string | null>(null);
  const runIdsRef = useRef<Set<string>>(new Set((initial?.runs ?? []).map((r) => r.id)));
  // 화면에 있는 detail의 run id — 초기/부트 데이터가 상세를 이미 실어 왔을 때
  // 선택 변경 효과가 같은 상세를 이중 페치하지 않게.
  const detailIdRef = useRef<string | null>(initial?.detail?.id ?? null);

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

  const applyDetail = useCallback((d: RunDetail) => {
    detailIdRef.current = d.id;
    setDetail(d);
  }, []);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        applyDetail(await api.getRun(id));
        setError(null);
      } catch (err) {
        fail(err, "작업 상세 로드 실패");
      }
    },
    [applyDetail, fail]
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

  // Client-side boot — 초기 데이터가 HTML에 실려 오지 못한 경우의 폴백만.
  // 목록과 최신 run 상세를 병렬로 받는다 (목록 → 선택 → 상세 폭포 방지).
  useEffect(() => {
    if (seeded.current) return;
    let cancelled = false;
    (async () => {
      const [runsRes, latestRes] = await Promise.allSettled([
        api.listRuns(project),
        api.getLatestRun(project),
      ]);
      if (cancelled) return;
      if (runsRes.status === "fulfilled") {
        setRuns(runsRes.value);
        runIdsRef.current = new Set(runsRes.value.map((d) => d.id));
      } else {
        fail(runsRes.reason, "작업 목록 로드 실패");
      }
      if (latestRes.status === "fulfilled" && latestRes.value) {
        const d = latestRes.value;
        applyDetail(d);
        setSelected((cur) => cur ?? d.id);
      } else if (runsRes.status === "fulfilled") {
        // 최신 상세 요청이 실패해도(404 제외) 목록 기준으로 폴백 선택 —
        // 선택 효과가 상세를 따로 받아온다.
        const first = runsRes.value[0]?.id ?? null;
        if (first) setSelected((cur) => cur ?? first);
      }
      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [project, applyDetail, fail]);

  // 프로젝트 설정(기본 저장소)은 시딩 여부와 무관하게 항상 로드.
  useEffect(() => {
    loadProject();
  }, [loadProject]);

  // Git repos on the server, for the picker (global — not project-specific).
  useEffect(() => {
    api.listRepos().then(setRepos).catch(() => setRepos([]));
  }, []);

  useEffect(() => {
    // 부트가 최신 상세를 이미 실어 왔으면(선택 = 그 run) 다시 받지 않는다.
    if (selected && detailIdRef.current !== selected) loadDetail(selected);
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

  // Re-run a stopped run (rejected/failed) from where it left off.
  const retry = useCallback(async () => {
    if (!detail) return;
    try {
      await api.retry(detail.id);
      setError(null);
      loadDetail(detail.id);
    } catch (err) {
      fail(err, "다시 진행 요청 실패", true);
    }
  }, [detail, loadDetail, fail]);

  // Discuss a stuck run with 호재(Opus) before deciding. Stateless — returns the
  // reply; the panel owns the thread state.
  const interveneChat = useCallback(
    async (messages: ChatMessage[]): Promise<string> => {
      if (!detail) return "";
      const { reply } = await api.interveneChat(detail.id, messages);
      return reply;
    },
    [detail]
  );

  return {
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
  };
}
