import type { ProjectSummary, Run, RunDetail, StartRunInput } from "./types";

// Single place that talks to the backend HTTP API. Centralizes URL building,
// the no-store cache policy, and consistent (Korean) error messages so pages
// and hooks never construct a raw fetch (SRP — one reason to change: the API).

async function getJson<T>(url: string, errLabel: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${errLabel} (${r.status})`);
  return r.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown, errLabel: string): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${errLabel} (${r.status})`);
  return r.json().catch(() => ({})) as Promise<T>;
}

export const api = {
  listProjects: () => getJson<ProjectSummary[]>("/api/projects", "프로젝트 목록 로드 실패"),

  createProject: (name: string) =>
    postJson<{ name: string }>("/api/projects", { name }, "프로젝트 생성 실패"),

  listRuns: (project: string) =>
    getJson<Run[]>(`/api/runs?project=${encodeURIComponent(project)}`, "작업 목록 로드 실패"),

  getRun: (id: string) => getJson<RunDetail>(`/api/runs/${id}`, "작업 상세 로드 실패"),

  startRun: (input: StartRunInput & { project: string }) =>
    postJson<{ id: string }>("/api/orchestrator/runs", input, "orchestrator 작업 시작 실패"),

  decide: (id: string, approved: boolean, editedPlan?: string) =>
    postJson<unknown>(
      `/api/orchestrator/runs/${id}/approve`,
      { approved, editedPlan: approved ? editedPlan : undefined },
      "승인/거절 요청 실패"
    ),
};
