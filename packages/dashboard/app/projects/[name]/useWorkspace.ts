"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { errMsg } from "../../lib/err";
import { useOrchestratorEvents } from "../../lib/hooks/useOrchestratorEvents";
import type {
  ChatMessage,
  InterventionDecision,
  PlanFeedRun,
  Run,
  RunDetail,
  StartRunInput,
} from "../../lib/types";

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
  // 기획 스레드 피드 — 프로젝트의 run들을 시간순으로 (기획 탭 전용).
  // null = 아직 로드 전 (빈 배열과 구분해 스켈레톤을 그릴 수 있게).
  const [feed, setFeed] = useState<PlanFeedRun[] | null>(null);

  const seeded = useRef(!!initial);
  const selectedRef = useRef<string | null>(null);
  const runIdsRef = useRef<Set<string>>(new Set((initial?.runs ?? []).map((r) => r.id)));
  // 화면에 있는 detail의 run id — 초기/부트 데이터가 상세를 이미 실어 왔을 때
  // 선택 변경 효과가 같은 상세를 이중 페치하지 않게.
  const detailIdRef = useRef<string | null>(initial?.detail?.id ?? null);

  // Errors from orchestrator actions add a hint to check the connection —
  // 단, 서버가 이유를 담아 응답한 상태 오류(ApiError, 예: 409 재개 불가)에는
  // 붙이지 않는다. 연결은 멀쩡한데 "연결을 확인하세요"라고 오도했던 문제.
  const fail = useCallback((err: unknown, fallback: string, hint = false) => {
    const base = errMsg(err, fallback);
    const connectivity = hint && !(err instanceof ApiError);
    setError(connectivity ? `${base} - dashboard 서버의 orchestrator 연결을 확인하세요.` : base);
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

  // 기획 피드 — 실패해도 페이지의 다른 부분은 살아 있어야 하므로 조용히 두고
  // (에러 배너는 목록/상세 로드가 담당), 성공 시에만 갱신한다.
  const loadFeed = useCallback(async () => {
    try {
      setFeed(await api.getPlanFeed(project));
    } catch {
      /* 피드는 다음 이벤트에서 재시도된다 */
    }
  }, [project]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

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
        // 어떤 이벤트든 목록·피드는 갱신하고, 화면에 열려 있는 run의 이벤트일
        // 때만 상세를 다시 받는다 (모르는 새 run이면 목록 갱신이 잡아 온다).
        loadRuns();
        loadFeed();
        if (runIdsRef.current.has(e.runId) && e.runId === selectedRef.current) loadDetail(e.runId);
      } catch {}
    },
    [loadRuns, loadDetail, loadFeed]
  );
  useOrchestratorEvents(onEvent);

  const start = useCallback(
    async (input: StartRunInput): Promise<boolean> => {
      try {
        const { id } = await api.startRun({ ...input, project });
        setSelected(id);
        setError(null);
        loadRuns();
        loadFeed();
        return true;
      } catch (err) {
        fail(err, "orchestrator 작업 시작 실패", true);
        return false;
      }
    },
    [project, loadRuns, loadFeed, fail]
  );

  // 액션 후 화면 동기화 — 피드는 항상, 상세는 그 run이 열려 있을 때만.
  const refreshAfterAction = useCallback(
    (runId: string) => {
      loadFeed();
      if (selectedRef.current === runId) loadDetail(runId);
    },
    [loadFeed, loadDetail]
  );

  // 아래 액션들은 모두 대상 run id를 명시적으로 받는다 — 작업 탭(선택된 run)과
  // 기획 피드(카드마다 다른 run)가 같은 배선을 쓰기 위해.
  // 실패는 배너를 띄운 뒤 다시 던진다 — 버튼 busy 상태(useBusyAction)는 throw로만
  // 실패를 알 수 있어서, 삼키면 버튼이 "⏳ 재개 중…"에 영원히 갇힌다.
  const decide = useCallback(
    async (runId: string, approved: boolean, editedPlan?: string) => {
      try {
        if (approved) await api.approve(runId, editedPlan);
        else await api.reject(runId);
        setError(null);
        refreshAfterAction(runId);
      } catch (err) {
        fail(err, "승인/거절 요청 실패", true);
        throw err;
      }
    },
    [refreshAfterAction, fail]
  );

  // Send feedback to re-plan (interactive refinement). The plan updates over SSE.
  const revise = useCallback(
    async (runId: string, feedback: string) => {
      try {
        await api.revise(runId, feedback);
        setError(null);
        refreshAfterAction(runId);
      } catch (err) {
        fail(err, "수정 요청 실패", true);
        throw err;
      }
    },
    [refreshAfterAction, fail]
  );

  // Resolve a run stuck at needs_input (guide/commit/skip/abort).
  const intervene = useCallback(
    async (runId: string, decision: InterventionDecision) => {
      try {
        await api.resume(runId, decision);
        setError(null);
        refreshAfterAction(runId);
      } catch (err) {
        fail(err, "재개 요청 실패", true);
        throw err;
      }
    },
    [refreshAfterAction, fail]
  );

  // Re-run a stopped run (rejected/failed) from where it left off.
  const retry = useCallback(
    async (runId: string) => {
      try {
        await api.retry(runId);
        setError(null);
        refreshAfterAction(runId);
      } catch (err) {
        fail(err, "다시 진행 요청 실패", true);
        throw err;
      }
    },
    [refreshAfterAction, fail]
  );

  // Discuss a stuck run with 호재(Opus) before deciding. Stateless — returns the
  // reply; the panel owns the thread state.
  const interveneChat = useCallback(
    async (runId: string, messages: ChatMessage[]): Promise<string> => {
      const { reply } = await api.interveneChat(runId, messages);
      return reply;
    },
    []
  );

  return {
    runs,
    selected,
    setSelected,
    detail,
    feed,
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
