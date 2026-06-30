import { ORCHESTRATOR_URL } from "../base";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const upstream = await fetch(`${ORCHESTRATOR_URL}/runs`, {
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

