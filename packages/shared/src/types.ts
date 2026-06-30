// Shared status + phase vocabulary, used by orchestrator and dashboard.

export type RunStatus =
  | "planning"
  | "awaiting_approval"
  | "building"
  | "verifying"
  | "committed"
  | "rejected"
  | "failed"
  | "cancelled";

export type Phase =
  | "plan"
  | "approval"
  | "build"
  | "verify"
  | "commit"
  | "system";

// Server-Sent Event payload broadcast on every state change / log line.
export interface BusEvent {
  type: "event" | "verdict" | "status" | "run";
  runId: string;
  phase?: Phase;
  level?: "info" | "warn" | "error";
  model?: string | null;
  message?: string;
  status?: RunStatus;
  attempt?: number;
  passed?: boolean;
  ts: string;
}

// Shape codex is forced to emit via --output-schema.
export interface CodexVerdict {
  verdict: "PASS" | "FAIL";
  reason: string;
}

// One model invocation's token usage, as captured by the orchestrator.
export interface UsageRecord {
  engine: "claude" | "codex";
  model: string;
  phase: Phase;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}
