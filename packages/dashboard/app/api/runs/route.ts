import { orchProxy } from "../../lib/orch";

export const dynamic = "force-dynamic";

// List runs (newest first), optional ?project= scope. Served by the orchestrator
// (DB owner) so the container never reads SQLite over the bind mount.
export async function GET(req: Request) {
  const project = new URL(req.url).searchParams.get("project");
  const qs = project ? `?project=${encodeURIComponent(project)}` : "";
  return orchProxy(`/data/runs${qs}`);
}
