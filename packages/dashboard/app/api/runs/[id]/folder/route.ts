import { orchProxy } from "../../../../lib/orch";

export const dynamic = "force-dynamic";

// Move a run into a research folder (folderId: null = 미분류).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return orchProxy(`/data/runs/${encodeURIComponent(id)}/folder`, {
    method: "PATCH",
    body: await req.text(),
  });
}
