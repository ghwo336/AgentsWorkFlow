import { CHAT_PAGE, LOG_PAGE, STEP_PREVIEW } from "../../lib/api";
import { orchJson } from "../../lib/server/orch";
import type { Run, RunDetail } from "../../lib/types";
import { Workspace } from "./_components/Workspace";

export const dynamic = "force-dynamic";

// Server component: the first paint's data (run list + latest run detail) is
// fetched HERE, orchestrator-local (~1ms), and shipped inside the HTML — the
// browser doesn't waterfall HTML → JS → fetch over the tunnel anymore. The
// client Workspace keeps it live over SSE afterward.
export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const project = decodeURIComponent(name);
  const enc = encodeURIComponent(project);
  const [runs, detail] = await Promise.all([
    orchJson<Run[]>(`/data/runs?project=${enc}`).catch(() => [] as Run[]),
    // 404 = run 없는 프로젝트 (에러 아님 — 빈 상태로 시작).
    orchJson<RunDetail>(
      `/data/runs/latest?project=${enc}&eventsTake=${LOG_PAGE}&chatTake=${CHAT_PAGE}&verdicts=0&stepSummaryMax=${STEP_PREVIEW}`
    ).catch(() => null),
  ]);
  // key=project: 프로젝트 간 클라이언트 내비게이션 시 상태를 통째로 리셋해
  // 이전 프로젝트의 목록/상세가 잔상으로 남지 않게 한다.
  return <Workspace key={project} project={project} initialRuns={runs} initialDetail={detail} />;
}
