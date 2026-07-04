import { ORCH_URL, orchHeaders } from "../../../lib/server/orch";

export const dynamic = "force-dynamic";

// SSE passthrough — the one orchestrator route that can't use orchProxy: it
// must keep the response streaming with event-stream headers, and fail fast
// with a 502 when the upstream isn't there (EventSource retries on its own).
export async function GET() {
  const upstream = await fetch(`${ORCH_URL}/events`, { cache: "no-store", headers: orchHeaders() });

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
