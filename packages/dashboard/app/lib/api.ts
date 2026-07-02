import type { ChatMessage, Project, ProjectSummary, Run, RunDetail, StartRunInput } from "./types";

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

  setProjectDir: (name: string, defaultTargetDir: string) =>
    sendJson<Project>(
      "PATCH",
      `/api/projects/${encodeURIComponent(name)}`,
      { defaultTargetDir },
      "기본 저장소 저장 실패"
    ),

  listRuns: (project: string) =>
    getJson<Run[]>(`/api/runs?project=${encodeURIComponent(project)}`, "작업 목록 로드 실패"),

  getRun: (id: string) => getJson<RunDetail>(`/api/runs/${id}`, "작업 상세 로드 실패"),

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
  resume: (
    id: string,
    decision:
      | { action: "guide"; feedback: string }
      | { action: "commit" }
      | { action: "skip" }
      | { action: "abort" }
  ) => postJson<unknown>(`/api/orchestrator/runs/${id}/resume`, decision, "재개 요청 실패"),
};
