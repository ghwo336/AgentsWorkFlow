import { orchProxy } from "../../lib/orch";

export const dynamic = "force-dynamic";

// Research folder list + create — served by the orchestrator (DB owner).
export async function GET() {
  return orchProxy(`/data/research-folders`);
}

export async function POST(req: Request) {
  return orchProxy(`/data/research-folders`, { method: "POST", body: await req.text() });
}
