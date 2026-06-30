import type { Phase, RunStatus, UsageRecord } from "@agent-loop/shared/types";
import { logEvent, recordUsage, recordVerdict, setStatus } from "./events.js";

export type LogOpts = { level?: "info" | "warn" | "error"; model?: string | null };
export type StatusExtra = Partial<{ plan: string; commit: string; error: string; targetDir: string }>;

// Per-run reporting surface. The pipeline and agents depend on THIS abstraction
// instead of reaching into the persistence/broadcast module directly (DIP), and
// binding the runId here removes the need to thread it through every call.
export interface RunReporter {
  log(phase: Phase, message: string, opts?: LogOpts): Promise<void>;
  status(status: RunStatus, extra?: StatusExtra): Promise<void>;
  usage(u: UsageRecord): Promise<void>;
  verdict(attempt: number, passed: boolean, reason: string, diff?: string, raw?: string): Promise<void>;
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
}
