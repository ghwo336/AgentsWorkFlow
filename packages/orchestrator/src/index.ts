import { timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { prisma } from "@agent-loop/shared/db";
import { validateAgents } from "@agent-loop/shared/roster";
import { bus } from "./bus.js";
import { clarify, interveneChatForRun } from "./chat.js";
import { config } from "./config.js";
import { registerAgentRoutes } from "./http-agents.js";
import { registerDataRoutes } from "./http-data.js";
import { resolveApproval, resolveInput, retryRun, startRun } from "./runner.js";
import { sweepOrphans } from "./startup-sweep.js";
import { assertAllowedTargetDir, TargetDirError } from "./workspace-path.js";

// Before serving anything, close out work orphaned by the previous process —
// otherwise 'running' steps from a dead build stay running forever in the UI.
await sweepOrphans();

const app = Fastify({ logger: false });

// No CORS on purpose: the only legitimate client is the dashboard's SERVER
// (orch.ts / the SSE passthrough route) — browsers never call us directly.
// Reflecting arbitrary origins here would let any webpage open in a browser on
// this machine read/drive the API on 127.0.0.1.

// Shared-secret auth. Every route except /health requires the dashboard's
// Bearer token when ORCH_TOKEN is set; without it any local process (or any
// webpage, absent the CORS/token pair) could start runs and read the DB.
const expectedAuth = config.apiToken ? Buffer.from(`Bearer ${config.apiToken}`) : null;
app.addHook("onRequest", async (req, reply) => {
  if (!expectedAuth) return; // 토큰 미설정 — 로컬 개발 모드 (부팅 로그에 경고)
  if (req.url === "/health") return;
  const got = Buffer.from(req.headers.authorization ?? "");
  const ok = got.length === expectedAuth.length && timingSafeEqual(got, expectedAuth);
  if (!ok) return reply.code(401).send({ error: "unauthorized" });
});

app.get("/health", async () => ({ ok: true }));

// DB read/write API for the dashboard (see http-data.ts — avoids the container
// touching the SQLite file over a bind mount).
registerDataRoutes(app);

// Agent roster/harness API (file-backed) for the dashboard's 팀 소개.
registerAgentRoutes(app);

// Start a new run.
const StartSchema = z.object({
  title: z.string().min(1),
  brief: z.string().min(1),
  project: z.string().optional(),
  targetDir: z.string().optional(),
  workspaceName: z.string().optional(),
  // Participating roster seat keys; omit ENTIRELY for the full team. When the
  // field is present it is validated strictly — empty lists and unknown keys
  // are rejected (never silently coerced to "전원"), and the combo must be
  // runnable — e.g. 기획+검증 without 개발 is rejected.
  agents: z.array(z.string()).optional(),
});
app.post("/runs", async (req, reply) => {
  const parsed = StartSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }
  if (parsed.data.agents !== undefined) {
    const invalid = validateAgents(parsed.data.agents);
    if (invalid) return reply.code(400).send({ error: invalid });
  }
  // An explicit targetDir becomes the run's trusted workspace root, so it must
  // sit inside an allowlisted root — reject here, before any run row exists.
  if (parsed.data.targetDir?.trim()) {
    try {
      await assertAllowedTargetDir(parsed.data.targetDir, config.allowedTargetRoots);
    } catch (err) {
      if (err instanceof TargetDirError) return reply.code(400).send({ error: err.message });
      throw err;
    }
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
// the client sends the whole thread; chat.ts assembles the stuck context.
app.post("/runs/:id/intervene-chat", async (req, reply) => {
  const { id } = req.params as { id: string };
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  try {
    const text = await interveneChatForRun(id, parsed.data.messages);
    if (text === null) return reply.code(404).send({ error: "not found" });
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
if (!config.apiToken) {
  console.warn(
    "⚠️  ORCH_TOKEN이 설정되지 않아 HTTP API가 무인증으로 열립니다 — 로컬 개발 외에는 루트 .env에 ORCH_TOKEN을 설정하세요."
  );
}

// Graceful shutdown so prisma/fastify release cleanly under tsx watch.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
