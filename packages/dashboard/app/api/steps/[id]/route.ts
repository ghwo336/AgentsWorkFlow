import { orchProxy } from "../../../lib/orch";

export const dynamic = "force-dynamic";

// One step's full row — the live view ships truncated summaries and fetches
// the whole text here only when the user expands one.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return orchProxy(`/data/steps/${encodeURIComponent(id)}`);
}
