import { orchProxy } from "../../../lib/orch";

export const dynamic = "force-dynamic";

// One project's record + settings update — served by the orchestrator (DB owner).
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return orchProxy(`/data/projects/${encodeURIComponent(name)}`);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return orchProxy(`/data/projects/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: await req.text(),
  });
}
