import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { prisma } from "@agent-loop/shared/db";
import { bus } from "./bus.js";
import { clarify, interveneChat } from "./chat.js";
import { config } from "./config.js";
import { registerDataRoutes } from "./http-data.js";
import { resolveApproval, resolveInput, retryRun, startRun } from "./runner.js";
import { sweepOrphans } from "./startup-sweep.js";

// Before serving anything, close out work orphaned by the previous process —
// otherwise 'running' steps from a dead build stay running forever in the UI.
await sweepOrphans();

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

// DB read/write API for the dashboard (see http-data.ts — avoids the container
// touching the SQLite file over a bind mount).
registerDataRoutes(app);

// Start a new run.
const StartSchema = z.object({
  title: z.string().min(1),
  brief: z.string().min(1),
  project: z.string().optional(),
  targetDir: z.string().optional(),
  workspaceName: z.string().optional(),
});
app.post("/runs", async (req, reply) => {
  const parsed = StartSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }
  const id = await startRun(parsed.data);
  return reply.code(201).send({ id });
});

// Decide on a pending plan: approve, reject, or revise (send feedback to re-plan).
const DecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), editedPlan: z.string().optional() }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("revise"), feedback: z.string().min(1) }),
]);
app.post("/runs/:id/approve", async (req, reply) => {
  const { id } = req.params as { id: string };
  const parsed = DecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }
  const ok = await resolveApproval(id, parsed.data);
  if (!ok) {
    return reply.code(409).send({ error: "No run awaiting approval with that id." });
  }
  return { ok: true };
});

// Resolve a run parked at needs_input (a step stuck after retries + 호재 escalation):
// guide (send fix instructions), commit (accept as-is), skip, or abort.
const InputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("guide"), feedback: z.string().min(1) }),
  z.object({ action: z.literal("commit") }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("abort") }),
]);
app.post("/runs/:id/resume", async (req, reply) => {
  const { id } = req.params as { id: string };
  const parsed = InputSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }
  const ok = await resolveInput(id, parsed.data);
  if (!ok) {
    return reply.code(409).send({ error: "No run awaiting input with that id." });
  }
  return { ok: true };
});

// Talk to 호재(Opus) about a stuck (needs_input) run before deciding. Stateless:
// the client sends the whole thread; we seed 호재 with the run's stuck context.
app.post("/runs/:id/intervene-chat", async (req, reply) => {
  const { id } = req.params as { id: string };
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const run = await prisma.run.findUnique({ where: { id } });
  if (!run) return reply.code(404).send({ error: "not found" });

  // Which plan step is stuck = number of already-resolved (passed/skipped) commits.
  let steps: string[] = [];
  try {
    const arr = run.planSteps ? JSON.parse(run.planSteps) : [];
    if (Array.isArray(arr)) steps = arr.map((s) => String(s));
  } catch {
    /* ignore */
  }
  const resolved = await prisma.step.count({
    where: { runId: id, kind: "commit", status: { in: ["passed", "skipped"] } },
  });
  const stuckIdx = Math.min(resolved, Math.max(0, steps.length - 1));
  const recentFails = await prisma.verdict.findMany({
    where: { runId: id, passed: false },
    orderBy: { ts: "desc" },
    take: 3,
  });

  const context = [
    `## 승인된 계획\n${(run.plan ?? "(없음)").slice(0, 4000)}`,
    steps.length
      ? `## 막힌 단계 (${stuckIdx + 1}/${steps.length})\n${steps[stuckIdx] ?? "(알 수 없음)"}`
      : "",
    run.error ? `## 중단 사유\n${run.error}` : "",
    recentFails.length
      ? `## 최근 검증 실패 사유\n${recentFails.map((v, i) => `${i + 1}. ${v.reason}`).join("\n\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const text = await interveneChat(context, parsed.data.messages);
    return { reply: text };
  } catch (err) {
    return reply.code(502).send({ error: (err as Error)?.message ?? "chat failed" });
  }
});

// Re-run a stopped run (rejected/failed/needs_input) from where it left off.
app.post("/runs/:id/retry", async (req, reply) => {
  const { id } = req.params as { id: string };
  const ok = await retryRun(id);
  if (!ok) {
    return reply.code(409).send({ error: "Run is not resumable (no approved plan or wrong status)." });
  }
  return { ok: true };
});

// Pre-plan requirements chat. Stateless: the client sends the whole thread and
// gets Opus's next reply. No run is created until the user commits to a plan.
const ChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      })
    )
    .min(1),
});
app.post("/chat", async (req, reply) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }
  try {
    const text = await clarify(parsed.data.messages);
    return { reply: text };
  } catch (err) {
    return reply.code(502).send({ error: (err as Error)?.message ?? "chat failed" });
  }
});

// Live event stream (Server-Sent Events).
app.get("/events", async (req, reply) => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  reply.raw.write(`: connected\n\n`);

  const send = (e: unknown) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
  const unsubscribe = bus.subscribe(send);

  const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 15000);
  req.raw.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
});

await app.listen({ port: config.port, host: config.host });
console.log(`orchestrator listening on http://${config.host}:${config.port}`);
console.log(`workspaces dir: ${config.workspacesDir}`);

// Graceful shutdown so prisma/fastify release cleanly under tsx watch.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
