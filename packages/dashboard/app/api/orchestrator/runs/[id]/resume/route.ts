import { ORCHESTRATOR_URL } from "../../../base";

export const dynamic = "force-dynamic";

// Proxy a needs_input resolution (guide/commit/skip/abort) to the orchestrator.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const upstream = await fetch(`${ORCHESTRATOR_URL}/runs/${encodeURIComponent(id)}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await req.text(),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}
