import { orchProxy } from "../../../../../lib/orch";

export const dynamic = "force-dynamic";

// Proxy a plan decision (approve/reject/revise) to the orchestrator.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return orchProxy(`/runs/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    body: await req.text(),
  });
}
