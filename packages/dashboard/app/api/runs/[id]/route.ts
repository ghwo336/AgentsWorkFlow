import { orchProxy } from "../../../lib/orch";

export const dynamic = "force-dynamic";

// Run detail, served by the orchestrator. Query params pass through — the live
// view asks for a bounded payload (?eventsTake/&chatTake/&verdicts=0).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { search } = new URL(req.url);
  return orchProxy(`/data/runs/${encodeURIComponent(id)}${search}`);
}
