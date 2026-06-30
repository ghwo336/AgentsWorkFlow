import { prisma } from "@agent-loop/shared/db";

export const dynamic = "force-dynamic";

// Full run detail: timeline events + codex verdicts.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await prisma.run.findUnique({
    where: { id },
    include: {
      events: { orderBy: { ts: "asc" } },
      verdicts: { orderBy: { ts: "asc" } },
    },
  });
  if (!run) return new Response("Not found", { status: 404 });
  return Response.json(run);
}
