import { prisma } from "@agent-loop/shared/db";
import { costUsd } from "@agent-loop/shared/pricing";
import type { Phase, RunStatus, UsageRecord } from "@agent-loop/shared/types";
import { bus } from "./bus.js";

// Append a timeline event: persist to DB + broadcast over SSE.
export async function logEvent(
  runId: string,
  phase: Phase,
  message: string,
  opts: { level?: "info" | "warn" | "error"; model?: string | null } = {}
) {
  const level = opts.level ?? "info";
  const model = opts.model ?? null;
  const row = await prisma.event.create({
    data: { runId, phase, message, level, model },
  });
  bus.publish({
    type: "event",
    runId,
    phase,
    level,
    model,
    message,
    ts: row.ts.toISOString(),
  });
  // mirror to stdout for terminal visibility
  console.log(`[${runId.slice(0, 6)}][${phase}] ${message}`);
}

// Transition a run's status: persist + broadcast.
export async function setStatus(
  runId: string,
  status: RunStatus,
  extra: Partial<{ plan: string; commit: string; error: string; targetDir: string }> = {}
) {
  await prisma.run.update({ where: { id: runId }, data: { status, ...extra } });
  bus.publish({
    type: "status",
    runId,
    status,
    ts: new Date().toISOString(),
  });
}

// Record one model invocation's token usage + API-equivalent cost in USD.
export async function recordUsage(runId: string, u: UsageRecord) {
  const cost = costUsd(u.model, u);
  await prisma.usage.create({
    data: {
      runId,
      engine: u.engine,
      model: u.model,
      phase: u.phase,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
      costUsd: cost,
    },
  });
  const total = u.inputTokens + u.outputTokens + u.cacheRead + u.cacheWrite;
  await logEvent(
    runId,
    u.phase,
    `📊 ${u.model}: ${total.toLocaleString()} 토큰 사용 (≈ $${cost.toFixed(4)})`,
    { model: u.engine }
  );
}

// Record a codex verification attempt.
export async function recordVerdict(
  runId: string,
  attempt: number,
  passed: boolean,
  reason: string,
  diff?: string,
  raw?: string
) {
  await prisma.verdict.create({
    data: { runId, attempt, passed, reason, diff, raw },
  });
  bus.publish({
    type: "verdict",
    runId,
    attempt,
    passed,
    message: reason,
    ts: new Date().toISOString(),
  });
}
