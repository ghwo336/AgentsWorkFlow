// Shared status + phase vocabulary, used by orchestrator and dashboard.

export type RunStatus =
  | "planning"
  | "awaiting_approval"
  | "building"
  | "verifying"
  | "needs_input" // a step exhausted retries + 호재 escalation → waiting for the user
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

// A Step is one agent's unit of work within a run (a span with a lifecycle),
// as opposed to Phase which is a coarse pipeline stage label on a log line.
export type StepKind = "plan" | "build" | "verify" | "review" | "test" | "commit";

export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

// Server-Sent Event payload broadcast on every state change / log line.
// `step` events carry the step-specific fields; older consumers can ignore
// them since every added field is optional.
export interface BusEvent {
  type: "event" | "verdict" | "status" | "run" | "step";
  runId: string;
  phase?: Phase;
  level?: "info" | "warn" | "error";
  model?: string | null;
  message?: string;
  status?: RunStatus;
  attempt?: number;
  passed?: boolean;
  // step fields (present when type === "step")
  stepId?: string;
  parentId?: string | null;
  kind?: StepKind;
  label?: string;
  engine?: string | null;
  stepStatus?: StepStatus;
  summary?: string | null;
  startedAt?: string;
  endedAt?: string | null;
  orderIdx?: number;
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
