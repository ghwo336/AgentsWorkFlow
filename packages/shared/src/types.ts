// Shared status + phase vocabulary, used by orchestrator and dashboard.

export type RunStatus =
  | "planning"
  | "awaiting_approval"
  | "building"
  | "verifying"
  | "researching" // 리서치 전용 run — 상현이 조사/보고서 작성 중
  | "needs_input" // a step exhausted retries + 호재 escalation → waiting for the user
  | "committed"
  | "reported" // 리서치 완료 — 보고서가 나왔고 후속 질문을 받을 수 있는 상태
  | "rejected"
  | "failed"
  | "cancelled";

export type Phase =
  | "plan"
  | "approval"
  | "build"
  | "verify"
  | "research"
  | "commit"
  | "system";

// A Step is one agent's unit of work within a run (a span with a lifecycle),
// as opposed to Phase which is a coarse pipeline stage label on a log line.
export type StepKind = "plan" | "build" | "verify" | "review" | "test" | "commit" | "research";

export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

// Server-Sent Event payload broadcast on every state change / log line.
// `step` events carry the step-specific fields; older consumers can ignore
// them since every added field is optional.
// Who is speaking + what kind of turn it is in the team chat.
export type ChatRole = "plan" | "build" | "verify" | "research" | "system" | "user";
export type ChatKind = "build" | "verify" | "escalate" | "guide" | "commit" | "note";

// One turn in a run's agent conversation (구현→검증→구현 loop + 호재 escalation +
// user guidance). Persisted (ChatMsg) and broadcast; role+attempt resolve to the
// same pixel character the step avatars use.
export interface ChatTurn {
  role: ChatRole;
  attempt: number;
  kind: ChatKind;
  toRole?: ChatRole | null;
  stepLabel?: string | null;
  passed?: boolean | null;
  // Which reviewer engine spoke (codex | claude | system) — lets the dashboard
  // attribute a verify turn to the right teammate now that the review fan-out
  // has multiple engines. Optional for backward compatibility.
  engine?: string | null;
  // Roster agent id of the speaker (hojae/taekyung/…). When present the
  // dashboard seats the turn directly; legacy turns fall back to role+attempt.
  agent?: string | null;
  text: string;
}

export interface BusEvent {
  type: "event" | "verdict" | "status" | "run" | "step" | "chat";
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
  agent?: string | null; // roster agent id who owns the step span
  stepStatus?: StepStatus;
  summary?: string | null;
  startedAt?: string;
  endedAt?: string | null;
  orderIdx?: number;
  ts: string;
}

// The user's decision on a run parked at needs_input (a step that exhausted
// retries + lead escalation). Single source of truth for the vocabulary shared
// by the orchestrator (HTTP schema, pipeline) and the dashboard (API client).
export type InterventionDecision =
  | { action: "guide"; feedback: string } // re-run the stuck step with this guidance
  | { action: "commit" } // accept the current (rejected) diff as-is
  | { action: "skip" } // discard the stuck step's changes and move on
  | { action: "abort" }; // stop the run

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
  // Roster agent id this invocation belongs to (hojae/taekyung/…), for the
  // per-agent usage view. Usually stamped by the StepHandle it runs under.
  agent?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}
