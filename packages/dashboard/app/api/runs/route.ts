import { prisma } from "@agent-loop/shared/db";

export const dynamic = "force-dynamic";

// List runs (newest first) for the Live + History views.
// Optional ?project=<name> scopes the list to one project.
export async function GET(req: Request) {
  const project = new URL(req.url).searchParams.get("project") ?? undefined;
  const runs = await prisma.run.findMany({
    where: project ? { project } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return Response.json(runs);
}
