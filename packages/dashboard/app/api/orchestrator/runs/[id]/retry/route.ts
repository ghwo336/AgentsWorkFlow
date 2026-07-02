import { orchProxy } from "../../../../../lib/orch";

export const dynamic = "force-dynamic";

// Proxy a "resume this run" (rejected/failed/needs_input → continue) to the orchestrator.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return orchProxy(`/runs/${encodeURIComponent(id)}/retry`, { method: "POST", body: "{}" });
}
