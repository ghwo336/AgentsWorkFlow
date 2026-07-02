import { orchProxy } from "../../../lib/orch";

export const dynamic = "force-dynamic";

// Pre-plan requirements chat — forwarded to the orchestrator's POST /chat.
export async function POST(req: Request) {
  return orchProxy("/chat", { method: "POST", body: await req.text() });
}
