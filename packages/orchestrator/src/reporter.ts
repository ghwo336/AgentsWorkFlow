import type { ChatTurn, Phase, RunStatus, StepStatus, UsageRecord } from "@agent-loop/shared/types";
import {
  addChat,
  createStep,
  logEvent,
  recordUsage,
  recordVerdict,
  setStatus,
  updateStep,
  type CreateStepInput,
} from "./events.js";

export type LogOpts = { level?: "info" | "warn" | "error"; model?: string | null };
export type StatusExtra = Partial<{ plan: string; commit: string; error: string; targetDir: string }>;

// The minimal surface an agent needs while doing its work: emit log lines and
// token usage. Both the run-level reporter and a per-step handle satisfy it, so
// an agent can be handed a StepHandle to attribute everything to its step (ISP).
export interface PhaseReporter {
  log(phase: Phase, message: string, opts?: LogOpts): Promise<void>;
  usage(u: UsageRecord): Promise<void>;
}

// A handle bound to one Step. Its log/usage/verdict calls are attributed to the
// step, and finish() closes the span with a terminal status. This keeps the
// pipeline readable — it holds a handle instead of threading a stepId around.
export interface StepHandle extends PhaseReporter {
  readonly id: string;
  verdict(attempt: number, passed: boolean, reason: string, diff?: string, raw?: string): Promise<void>;
  finish(status: StepStatus, summary?: string): Promise<void>;
}

// Per-run reporting surface. The pipeline and agents depend on THIS abstraction
// instead of reaching into the persistence/broadcast module directly (DIP), and
// binding the runId here removes the need to thread it through every call.
export interface RunReporter extends PhaseReporter {
  status(status: RunStatus, extra?: StatusExtra): Promise<void>;
  verdict(attempt: number, passed: boolean, reason: string, diff?: string, raw?: string): Promise<void>;
  startStep(input: CreateStepInput): Promise<StepHandle>;
  chat(turn: ChatTurn): Promise<void>;
}

// DB-backed implementation: delegates to the events module (persist + SSE).
export class DbRunReporter implements RunReporter {
  constructor(private readonly runId: string) {}

  log(phase: Phase, message: string, opts: LogOpts = {}) {
    return logEvent(this.runId, phase, message, opts);
  }
  status(status: RunStatus, extra: StatusExtra = {}) {
    return setStatus(this.runId, status, extra);
  }
  usage(u: UsageRecord) {
    return recordUsage(this.runId, u);
  }
  verdict(attempt: number, passed: boolean, reason: string, diff?: string, raw?: string) {
    return recordVerdict(this.runId, attempt, passed, reason, diff, raw);
  }
  chat(turn: ChatTurn) {
    return addChat(this.runId, turn);
  }
  async startStep(input: CreateStepInput): Promise<StepHandle> {
    const runId = this.runId;
    const id = await createStep(runId, input);
    return {
      id,
      log: (phase, message, opts = {}) => logEvent(runId, phase, message, { ...opts, stepId: id }),
      usage: (u) => recordUsage(runId, u, id),
      verdict: (attempt, passed, reason, diff, raw) =>
        recordVerdict(runId, attempt, passed, reason, diff, raw, id),
      finish: (status, summary) => updateStep(id, { status, summary, end: true }),
    };
  }
}
