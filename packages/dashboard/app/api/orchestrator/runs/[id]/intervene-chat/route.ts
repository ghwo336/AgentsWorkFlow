import { orchProxy } from "../../../../../lib/orch";

export const dynamic = "force-dynamic";

// Proxy a needs_input discussion turn (user ↔ 호재) to the orchestrator.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return orchProxy(`/runs/${encodeURIComponent(id)}/intervene-chat`, {
    method: "POST",
    body: await req.text(),
  });
}
