import { ORCHESTRATOR_URL } from "../base";

export const dynamic = "force-dynamic";

export async function GET() {
  const upstream = await fetch(`${ORCHESTRATOR_URL}/events`, { cache: "no-store" });

  if (!upstream.ok || !upstream.body) {
    return new Response("orchestrator event stream unavailable", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

