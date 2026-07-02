import { orchProxy } from "../../../lib/orch";

export const dynamic = "force-dynamic";

// Start a new run — forwarded to the orchestrator's POST /runs.
export async function POST(req: Request) {
  return orchProxy("/runs", { method: "POST", body: await req.text() });
}
