import type { FastifyInstance } from "fastify";
import { prisma } from "@agent-loop/shared/db";

// Data API served by the orchestrator (a host process that OWNS the SQLite DB).
// The dashboard runs in Docker and previously read this same file over a macOS
// bind mount, which returns torn "database disk image is malformed" pages while
// the orchestrator is mid-write (during a build). Routing every DB read/write
// through the DB owner removes that cross-boundary access entirely — the mount
// is only used for the read-only repo scan now.
// Parse a ?take/?eventsTake query value: positive int, capped so a bad client
// can't ask the DB for everything through the "bounded" path. Absent/invalid → undefined.
function takeOf(raw: string | undefined): number | undefined {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return Math.min(n, 500);
}

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
  //
  // Long runs accumulate thousands of events and heavyweight chat turns, and the
  // live view refetches this on EVERY SSE event — so it can ask for a bounded
  // payload: ?eventsTake=N / ?chatTake=N return only the LATEST N rows (still in
  // ascending order) plus eventsTotal/chatTotal so the client can page older rows
  // via /data/runs/:id/events|chat. ?verdicts=0 drops verdicts (they carry whole
  // diffs; the live view never renders them). No params = full detail (archive
  // page, legacy callers).
  app.get("/data/runs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { eventsTake?: string; chatTake?: string; verdicts?: string };
    const eventsTake = takeOf(q.eventsTake);
    const chatTake = takeOf(q.chatTake);
    const run = await prisma.run.findUnique({
      where: { id },
      include: {
        events: eventsTake
          ? { orderBy: [{ ts: "desc" as const }, { id: "desc" as const }], take: eventsTake }
          : { orderBy: { ts: "asc" as const } },
        ...(q.verdicts === "0" ? {} : { verdicts: { orderBy: { ts: "asc" as const } } }),
        steps: { orderBy: [{ orderIdx: "asc" }, { startedAt: "asc" }] },
        chatMsgs: chatTake
          ? { orderBy: [{ ts: "desc" as const }, { id: "desc" as const }], take: chatTake }
          : { orderBy: { ts: "asc" as const } },
      },
    });
    if (!run) return reply.code(404).send({ error: "not found" });
    if (eventsTake) run.events.reverse();
    if (chatTake) run.chatMsgs.reverse();
    const [eventsTotal, chatTotal] = await Promise.all([
      eventsTake ? prisma.event.count({ where: { runId: id } }) : run.events.length,
      chatTake ? prisma.chatMsg.count({ where: { runId: id } }) : run.chatMsgs.length,
    ]);
    return { ...run, verdicts: (run as { verdicts?: unknown[] }).verdicts ?? [], eventsTotal, chatTotal };
  });

  // Older timeline events, newest-first cursor paging: rows strictly BEFORE the
  // `before` event id (exclusive), returned in ascending order for prepending.
  app.get("/data/runs/:id/events", async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { before?: string; take?: string };
    const rows = await prisma.event.findMany({
      where: { runId: id },
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
      take: takeOf(q.take) ?? 30,
    });
    return rows.reverse();
  });

  // Older team-chat turns — same cursor contract as /events.
  app.get("/data/runs/:id/chat", async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { before?: string; take?: string };
    const rows = await prisma.chatMsg.findMany({
      where: { runId: id },
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
      take: takeOf(q.take) ?? 10,
    });
    return rows.reverse();
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
