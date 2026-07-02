import { orchProxy } from "../../../../../lib/orch";

export const dynamic = "force-dynamic";

// Proxy a needs_input resolution (guide/commit/skip/abort) to the orchestrator.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return orchProxy(`/runs/${encodeURIComponent(id)}/resume`, {
    method: "POST",
    body: await req.text(),
  });
}
