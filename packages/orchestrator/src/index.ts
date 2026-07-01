import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import { prisma } from "@agent-loop/shared/db";
import { bus } from "./bus.js";
import { clarify } from "./chat.js";
import { config } from "./config.js";
import { resolveApproval, startRun } from "./runner.js";

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

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
