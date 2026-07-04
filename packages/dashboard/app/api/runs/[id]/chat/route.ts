import { orchProxy } from "../../../../lib/orch";

export const dynamic = "force-dynamic";

// Older team-chat turns (cursor paging via ?before=<msgId>&take=N).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { search } = new URL(req.url);
  return orchProxy(`/data/runs/${encodeURIComponent(id)}/chat${search}`);
}
