import { prisma } from "@agent-loop/shared/db";

export const dynamic = "force-dynamic";

// List all projects with per-project aggregates for the launcher.
export async function GET() {
  const [projects, runs, usages] = await Promise.all([
    prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.run.findMany({
      select: { project: true, status: true, createdAt: true, title: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.usage.findMany({ select: { costUsd: true, run: { select: { project: true } } } }),
  ]);

  // Make sure projects that only exist via runs still appear.
  const names = new Set(projects.map((p) => p.name));
  for (const r of runs) names.add(r.project);

  const summary = [...names].map((name) => {
    const projRuns = runs.filter((r) => r.project === name);
    const cost = usages
      .filter((u) => u.run.project === name)
      .reduce((acc, u) => acc + u.costUsd, 0);
    const latest = projRuns[0]; // runs already sorted desc
    return {
      name,
      runCount: projRuns.length,
      lastStatus: latest?.status ?? null,
      lastTitle: latest?.title ?? null,
      lastAt: latest?.createdAt ?? null,
      costUsd: cost,
    };
  });

  // Newest activity first; empty projects (no runs) sink to the bottom.
  summary.sort((a, b) => {
    const at = a.lastAt ? new Date(a.lastAt).getTime() : 0;
    const bt = b.lastAt ? new Date(b.lastAt).getTime() : 0;
    return bt - at;
  });

  return Response.json(summary);
}

// Create an empty project so runs can be added to it afterward.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  const project = await prisma.project.upsert({
    where: { name },
    create: { name },
    update: {},
  });
  return Response.json(project, { status: 201 });
}
