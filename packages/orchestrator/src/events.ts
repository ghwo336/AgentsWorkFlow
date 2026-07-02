import { prisma } from "@agent-loop/shared/db";
import { costUsd } from "@agent-loop/shared/pricing";
import type {
  Phase,
  RunStatus,
  StepKind,
  StepStatus,
  UsageRecord,
} from "@agent-loop/shared/types";
import { bus } from "./bus.js";

// Append a timeline event: persist to DB + broadcast over SSE.
export async function logEvent(
  runId: string,
  phase: Phase,
  message: string,
  opts: { level?: "info" | "warn" | "error"; model?: string | null; stepId?: string } = {}
) {
  const level = opts.level ?? "info";
  const model = opts.model ?? null;
  const row = await prisma.event.create({
    data: { runId, phase, message, level, model, stepId: opts.stepId ?? null },
  });
  bus.publish({
    type: "event",
    runId,
    phase,
    level,
    model,
    message,
    stepId: opts.stepId,
    ts: row.ts.toISOString(),
  });
  // mirror to stdout for terminal visibility
  console.log(`[${runId.slice(0, 6)}][${phase}] ${message}`);
}

// ── Steps (agent work spans) ───────────────────────────────────────────────
// A step is created when an agent starts its unit of work and updated when it
// finishes. Both persist + broadcast a `step` SSE event so the dashboard can
// live-render the kanban / node graph / timeline off the same data.
export interface CreateStepInput {
  parentId?: string | null;
  kind: StepKind;
  label: string;
  engine?: string | null;
  model?: string | null;
  attempt?: number;
  orderIdx?: number;
}

// The one place a Step row is turned into its SSE payload, so create/update
// can never drift apart in what they broadcast.
function publishStep(
  row: {
    id: string;
    runId: string;
    parentId: string | null;
    kind: string;
    label: string;
    engine: string | null;
    model: string | null;
    attempt: number;
    status: string;
    summary: string | null;
    orderIdx: number;
    startedAt: Date;
    endedAt: Date | null;
  },
  ts: Date
): void {
  bus.publish({
    type: "step",
    runId: row.runId,
    stepId: row.id,
    parentId: row.parentId,
    kind: row.kind as StepKind,
    label: row.label,
    engine: row.engine,
    model: row.model,
    attempt: row.attempt,
    stepStatus: row.status as StepStatus,
    summary: row.summary,
    orderIdx: row.orderIdx,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    ts: ts.toISOString(),
  });
}

export async function createStep(runId: string, input: CreateStepInput): Promise<string> {
  const row = await prisma.step.create({
    data: {
      runId,
      parentId: input.parentId ?? null,
      kind: input.kind,
      label: input.label,
      engine: input.engine ?? null,
      model: input.model ?? null,
      attempt: input.attempt ?? 1,
      orderIdx: input.orderIdx ?? 0,
      status: "running",
    },
  });
  publishStep(row, row.startedAt);
  return row.id;
}

export async function updateStep(
  stepId: string,
  patch: { status?: StepStatus; summary?: string | null; end?: boolean }
): Promise<void> {
  const row = await prisma.step.update({
    where: { id: stepId },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.end ? { endedAt: new Date() } : {}),
    },
  });
  publishStep(row, new Date());
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
export async function recordUsage(runId: string, u: UsageRecord, stepId?: string) {
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
      stepId: stepId ?? null,
    },
  });
  const total = u.inputTokens + u.outputTokens + u.cacheRead + u.cacheWrite;
  await logEvent(
    runId,
    u.phase,
    `📊 ${u.model}: ${total.toLocaleString()} 토큰 사용 (≈ $${cost.toFixed(4)})`,
    { model: u.engine, stepId }
  );
}

// Record a codex verification attempt.
export async function recordVerdict(
  runId: string,
  attempt: number,
  passed: boolean,
  reason: string,
  diff?: string,
  raw?: string,
  stepId?: string
) {
  await prisma.verdict.create({
    data: { runId, attempt, passed, reason, diff, raw, stepId: stepId ?? null },
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
