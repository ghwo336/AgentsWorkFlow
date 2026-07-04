import { orchProxy } from "../../../../../lib/orch";

export const dynamic = "force-dynamic";

// 리서치 후속 질문을 오케스트레이터로 전달 — 같은 run에 대화가 이어진다.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return orchProxy(`/runs/${encodeURIComponent(id)}/research-followup`, {
    method: "POST",
    body: await req.text(),
  });
}
