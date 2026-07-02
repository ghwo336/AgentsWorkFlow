import type { FastifyInstance } from "fastify";
import { prisma } from "@agent-loop/shared/db";

// Data API served by the orchestrator (a host process that OWNS the SQLite DB).
// The dashboard runs in Docker and previously read this same file over a macOS
// bind mount, which returns torn "database disk image is malformed" pages while
// the orchestrator is mid-write (during a build). Routing every DB read/write
// through the DB owner removes that cross-boundary access entirely — the mount
// is only used for the read-only repo scan now.
export function registerDataRoutes(app: FastifyInstance): void {
  // Runs list (newest first), optionally scoped to a project.
  app.get("/data/runs", async (req) => {
    const project = (req.query as { project?: string })?.project;
    return prisma.run.findMany({
      where: project ? { project } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });

  // Full run detail: timeline events + codex verdicts + step spans.
  app.get("/data/runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await prisma.run.findUnique({
      where: { id },
      include: {
        events: { orderBy: { ts: "asc" } },
        verdicts: { orderBy: { ts: "asc" } },
        steps: { orderBy: [{ orderIdx: "asc" }, { startedAt: "asc" }] },
      },
    });
    if (!run) return reply.code(404).send({ error: "not found" });
    return run;
  });

  // Run history (larger take, with verdict counts) for the History view.
  app.get("/data/history", async () => {
    return prisma.run.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { _count: { select: { verdicts: true } } },
    });
  });

  // All usage rows (with each row's project) for the Usage view.
  app.get("/data/usage", async () => {
    return prisma.usage.findMany({
      include: { run: { select: { project: true } } },
      orderBy: { ts: "desc" },
    });
  });

  // Project launcher summary: per-project run counts, last status, total cost.
  app.get("/data/projects", async () => {
    const [projects, runs, usages] = await Promise.all([
      prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.run.findMany({
        select: { project: true, status: true, createdAt: true, title: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.usage.findMany({ select: { costUsd: true, run: { select: { project: true } } } }),
    ]);

    const names = new Set(projects.map((p) => p.name));
    for (const r of runs) names.add(r.project);

    const summary = [...names].map((name) => {
      const projRuns = runs.filter((r) => r.project === name);
      const cost = usages
        .filter((u) => u.run.project === name)
        .reduce((acc, u) => acc + u.costUsd, 0);
      const latest = projRuns[0];
      return {
        name,
        runCount: projRuns.length,
        lastStatus: latest?.status ?? null,
        lastTitle: latest?.title ?? null,
        lastAt: latest?.createdAt ?? null,
        costUsd: cost,
      };
    });
    summary.sort((a, b) => {
      const at = a.lastAt ? new Date(a.lastAt).getTime() : 0;
      const bt = b.lastAt ? new Date(b.lastAt).getTime() : 0;
      return bt - at;
    });
    return summary;
  });

  // Create an empty project.
  app.post("/data/projects", async (req, reply) => {
    const body = (req.body as { name?: string }) ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return reply.code(400).send({ error: "name required" });
    const project = await prisma.project.upsert({ where: { name }, create: { name }, update: {} });
    return reply.code(201).send(project);
  });

  // One project's record.
  app.get("/data/projects/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const project = await prisma.project.findUnique({ where: { name } });
    if (!project) return reply.code(404).send({ error: "not found" });
    return project;
  });

  // Update a project's default working dir (empty string clears it).
  app.patch("/data/projects/:name", async (req) => {
    const { name } = req.params as { name: string };
    const body = (req.body as { defaultTargetDir?: string }) ?? {};
    const raw = typeof body.defaultTargetDir === "string" ? body.defaultTargetDir.trim() : "";
    const defaultTargetDir = raw || null;
    return prisma.project.upsert({
      where: { name },
      create: { name, defaultTargetDir },
      update: { defaultTargetDir },
    });
  });
}
