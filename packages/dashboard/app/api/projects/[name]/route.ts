import { prisma } from "@agent-loop/shared/db";

export const dynamic = "force-dynamic";

// One project's own record (currently: its remembered default repo dir).
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const project = await prisma.project.findUnique({ where: { name } });
  if (!project) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(project);
}

// Update the project's settings. Upserts so a project that only exists via runs
// can still be given a default dir. An empty string clears it (back to a fresh
// workspace per run).
export async function PATCH(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = await req.json().catch(() => ({}));
  const raw = typeof body.defaultTargetDir === "string" ? body.defaultTargetDir.trim() : "";
  const defaultTargetDir = raw || null;

  const project = await prisma.project.upsert({
    where: { name },
    create: { name, defaultTargetDir },
    update: { defaultTargetDir },
  });
  return Response.json(project);
}
