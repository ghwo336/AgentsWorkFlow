import type {
  ChatMessage,
  ChatMsg,
  InterventionDecision,
  Project,
  ProjectSummary,
  ResearchFolder,
  Run,
  RunDetail,
  RunEvent,
  StartRunInput,
  Step,
} from "./types";

// 라이브 뷰의 페이지 크기. 로그는 한 줄짜리라 넉넉히(30), 대화는 보고서
// 전문이 실려 무거우니 10 — "더보기"도 같은 단위로 가져온다.
export const LOG_PAGE = 30;
export const CHAT_PAGE = 10;
// step summary 미리보기 길이 — 카드 접힌 상태(180자)를 그리기에 충분하고,
// 전문은 더보기 시 getStep으로 가져온다.
export const STEP_PREVIEW = 300;

// 제안함 항목 — orchestrator learn-store의 Proposal과 같은 shape.
export interface LearningProposal {
  id: string;
  agentId: string;
  condition: string;
  lesson: string;
  evidence: string;
  project: string;
  runId: string;
  ts: string;
  status: "pending" | "approved" | "rejected";
}

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

  // 팀 학습 노트 (agents-config/learned/) — 프로젝트명/agentId → md 원문.
  agentLearned: () =>
    getJson<{ projects: Record<string, string>; agents: Record<string, string> }>(
      "/api/orchestrator/agents/learned",
      "학습 노트 로드 실패"
    ),

  // 제안함: 승인 대기 중인 에이전트 교훈.
  learningProposals: () =>
    getJson<LearningProposal[]>("/api/orchestrator/learning/proposals", "제안함 로드 실패"),

  // 제안 승인/거절 — 승인하면 그 팀원의 학습 파일에 편입돼 프롬프트에 주입된다.
  resolveProposal: (id: string, action: "approve" | "reject") =>
    postJson<unknown>(
      `/api/orchestrator/learning/proposals/${encodeURIComponent(id)}`,
      { action },
      "제안 결정 실패"
    ),

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
      `/api/runs/${id}?eventsTake=${LOG_PAGE}&chatTake=${CHAT_PAGE}&verdicts=0&stepSummaryMax=${STEP_PREVIEW}`,
      "작업 상세 로드 실패"
    ),

  // 잘려 온 step summary의 전문 — 작업 요약에서 더보기를 눌렀을 때만.
  getStep: (id: string) => getJson<Step>(`/api/steps/${id}`, "작업 내용 로드 실패"),

  // 리서치 스레드용 상세 — 대화(질문/보고서)가 본체라 chat을 넉넉히 가져온다.
  getResearchRun: (id: string) =>
    getJson<RunDetail>(
      `/api/runs/${id}?eventsTake=${LOG_PAGE}&chatTake=100&verdicts=0`,
      "리서치 상세 로드 실패"
    ),

  // 리서치 폴더 — 사용자가 만든 그룹(예: "블록체인")으로 리서치들을 묶는다.
  listResearchFolders: () =>
    getJson<ResearchFolder[]>("/api/research-folders", "리서치 폴더 로드 실패"),

  createResearchFolder: (name: string) =>
    postJson<ResearchFolder>("/api/research-folders", { name }, "폴더 생성 실패"),

  // 폴더 삭제 — 안의 리서치들은 지워지지 않고 미분류로 돌아간다.
  deleteResearchFolder: async (id: string) => {
    const r = await fetch(`/api/research-folders/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) throw new Error(`폴더 삭제 실패 (${r.status})`);
  },

  // 리서치를 폴더로 이동 (folderId: null = 미분류로 꺼내기).
  setRunFolder: (id: string, folderId: string | null) =>
    sendJson<Run>("PATCH", `/api/runs/${id}/folder`, { folderId }, "폴더 이동 실패"),

  // 리서치 후속 질문 — reported 상태의 run에 대화를 이어 붙인다.
  researchFollowUp: (id: string, question: string) =>
    postJson<unknown>(
      `/api/orchestrator/runs/${id}/research-followup`,
      { question },
      "후속 질문 전송 실패"
    ),

  // 프로젝트의 최신 run 상세를 한 왕복에 — 첫 진입의 목록→선택→상세 폭포 제거.
  // null = 아직 run이 없는 프로젝트 (에러 아님).
  getLatestRun: async (project: string): Promise<RunDetail | null> => {
    const r = await fetch(
      `/api/runs/latest?project=${encodeURIComponent(project)}&eventsTake=${LOG_PAGE}&chatTake=${CHAT_PAGE}&verdicts=0&stepSummaryMax=${STEP_PREVIEW}`,
      { cache: "no-store" }
    );
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`최근 작업 로드 실패 (${r.status})`);
    return r.json() as Promise<RunDetail>;
  },

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
