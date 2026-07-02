import { orchProxy } from "../../lib/orch";

export const dynamic = "force-dynamic";

// Project launcher summary + create — served by the orchestrator (DB owner).
export async function GET() {
  return orchProxy(`/data/projects`);
}

export async function POST(req: Request) {
  return orchProxy(`/data/projects`, { method: "POST", body: await req.text() });
}
