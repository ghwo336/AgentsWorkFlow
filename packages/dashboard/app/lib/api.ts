import type {
  ChatMessage,
  ChatMsg,
  InterventionDecision,
  Project,
  ProjectSummary,
  Run,
  RunDetail,
  RunEvent,
  StartRunInput,
} from "./types";

// 라이브 뷰의 페이지 크기. 로그는 한 줄짜리라 넉넉히(30), 대화는 보고서
// 전문이 실려 무거우니 10 — "더보기"도 같은 단위로 가져온다.
export const LOG_PAGE = 30;
export const CHAT_PAGE = 10;

// Single place that talks to the backend HTTP API. Centralizes URL building,
// the no-store cache policy, and consistent (Korean) error messages so pages
// and hooks never construct a raw fetch (SRP — one reason to change: the API).

async function getJson<T>(url: string, errLabel: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${errLabel} (${r.status})`);
  return r.json() as Promise<T>;
}

async function sendJson<T>(
  method: "POST" | "PATCH",
  url: string,
  body: unknown,
  errLabel: string
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${errLabel} (${r.status})`);
  return r.json().catch(() => ({})) as Promise<T>;
}

const postJson = <T>(url: string, body: unknown, errLabel: string) =>
  sendJson<T>("POST", url, body, errLabel);

export const api = {
  listProjects: () => getJson<ProjectSummary[]>("/api/projects", "프로젝트 목록 로드 실패"),

  createProject: (name: string) =>
    postJson<{ name: string }>("/api/projects", { name }, "프로젝트 생성 실패"),

  getProject: (name: string) =>
    getJson<Project>(`/api/projects/${encodeURIComponent(name)}`, "프로젝트 정보 로드 실패"),

  listRepos: () => getJson<string[]>("/api/repos", "저장소 목록 로드 실패"),

  // 팀 소개 모달용 — agentId → 하네스 md (agents-config/*.md 원문).
  agentHarnesses: () =>
    getJson<Record<string, string>>("/api/orchestrator/agents/harnesses", "하네스 로드 실패"),

  setProjectDir: (name: string, defaultTargetDir: string) =>
    sendJson<Project>(
      "PATCH",
      `/api/projects/${encodeURIComponent(name)}`,
      { defaultTargetDir },
      "기본 저장소 저장 실패"
    ),

  listRuns: (project: string) =>
    getJson<Run[]>(`/api/runs?project=${encodeURIComponent(project)}`, "작업 목록 로드 실패"),

  // 라이브 뷰용 상세 — SSE 이벤트마다 다시 받으므로 최신 로그/대화만 가져온다
  // (verdicts=0: diff가 실려 무겁고 라이브 뷰에선 안 쓴다). 과거분은 아래
  // olderRunEvents/olderRunChat으로 "더보기" 페이징.
  getRun: (id: string) =>
    getJson<RunDetail>(
      `/api/runs/${id}?eventsTake=${LOG_PAGE}&chatTake=${CHAT_PAGE}&verdicts=0`,
      "작업 상세 로드 실패"
    ),

  olderRunEvents: (id: string, before: string) =>
    getJson<RunEvent[]>(
      `/api/runs/${id}/events?before=${encodeURIComponent(before)}&take=${LOG_PAGE}`,
      "이전 로그 로드 실패"
    ),

  olderRunChat: (id: string, before: string) =>
    getJson<ChatMsg[]>(
      `/api/runs/${id}/chat?before=${encodeURIComponent(before)}&take=${CHAT_PAGE}`,
      "이전 대화 로드 실패"
    ),

  // Pre-plan requirements chat: send the whole thread, get Opus's next reply.
  chat: (messages: ChatMessage[]) =>
    postJson<{ reply: string }>("/api/orchestrator/chat", { messages }, "대화 요청 실패"),

  startRun: (input: StartRunInput & { project: string }) =>
    postJson<{ id: string }>("/api/orchestrator/runs", input, "orchestrator 작업 시작 실패"),

  approve: (id: string, editedPlan?: string) =>
    postJson<unknown>(
      `/api/orchestrator/runs/${id}/approve`,
      { action: "approve", editedPlan },
      "승인 요청 실패"
    ),

  reject: (id: string) =>
    postJson<unknown>(`/api/orchestrator/runs/${id}/approve`, { action: "reject" }, "거절 요청 실패"),

  // Send feedback so the planner (Opus) revises the plan — an interactive loop.
  revise: (id: string, feedback: string) =>
    postJson<unknown>(
      `/api/orchestrator/runs/${id}/approve`,
      { action: "revise", feedback },
      "수정 요청 실패"
    ),

  // Resolve a run stuck at needs_input: guide (fix instructions) / commit (accept
  // as-is) / skip (drop this step) / abort (stop the run).
  resume: (id: string, decision: InterventionDecision) =>
    postJson<unknown>(`/api/orchestrator/runs/${id}/resume`, decision, "재개 요청 실패"),

  // Re-run a stopped run (rejected/failed/needs_input) from where it left off.
  retry: (id: string) =>
    postJson<unknown>(`/api/orchestrator/runs/${id}/retry`, {}, "다시 진행 요청 실패"),

  // Discuss a stuck (needs_input) run with 호재(Opus) before deciding. Stateless:
  // send the whole thread, get 호재's next reply (seeded with the stuck context).
  interveneChat: (id: string, messages: ChatMessage[]) =>
    postJson<{ reply: string }>(
      `/api/orchestrator/runs/${id}/intervene-chat`,
      { messages },
      "호재와 대화 요청 실패"
    ),
};
