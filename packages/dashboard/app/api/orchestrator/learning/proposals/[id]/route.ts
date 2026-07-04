import { orchProxy } from "../../../../../lib/orch";

export const dynamic = "force-dynamic";

// 제안 결정(approve/reject)을 오케스트레이터로 전달.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return orchProxy(`/data/learning/proposals/${encodeURIComponent(id)}`, {
    method: "POST",
    body: await req.text(),
  });
}
