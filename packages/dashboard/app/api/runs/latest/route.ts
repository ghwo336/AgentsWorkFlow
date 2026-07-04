import { orchProxy } from "../../../lib/orch";

export const dynamic = "force-dynamic";

// Newest run's detail for a project (one round trip for the workspace's first
// paint). 404 = the project has no runs yet.
export async function GET(req: Request) {
  const { search } = new URL(req.url);
  return orchProxy(`/data/runs/latest${search}`);
}
