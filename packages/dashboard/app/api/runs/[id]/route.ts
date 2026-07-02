import { orchProxy } from "../../../lib/orch";

export const dynamic = "force-dynamic";

// Full run detail (events + verdicts + steps), served by the orchestrator.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return orchProxy(`/data/runs/${encodeURIComponent(id)}`);
}
