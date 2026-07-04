import { orchProxy } from "../../../lib/orch";

export const dynamic = "force-dynamic";

// Delete a research folder — its runs return to 미분류.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return orchProxy(`/data/research-folders/${encodeURIComponent(id)}`, { method: "DELETE" });
}
