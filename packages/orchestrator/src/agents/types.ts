import type { PhaseReporter } from "../reporter.js";
import type { StepKind } from "@agent-loop/shared/types";

// Outcome of a Claude phase (plan or build).
export interface AgentResult {
  text: string;
  isError: boolean;
}

export interface PlanRequest {
  brief: string;
  cwd: string;
  // For an interactive revision: the plan being revised + the user's requested
  // changes. When set, the planner revises rather than starting from scratch.
  previousPlan?: string;
  feedback?: string;
  // Auto-team run: the planner must also staff the team — append a ```team
  // block recommending which developers/verifiers fit this request.
  suggestTeam?: boolean;
  // Developers available for step assignment (seat key + specialty). When set,
  // every ```steps item must be {"desc", "dev"} — the planner matches each step
  // to the specialist whose stack fits it (프론트 단계→태경, API 단계→민재, …).
  assignableDevs?: Array<{ key: string; name: string; specialty?: string }>;
}

export interface BuildRequest {
  approvedPlan: string;
  brief: string;
  cwd: string;
  feedback?: string;
  // When set, the builder implements ONLY this one step of the plan, with the
  // already-completed steps given as context.
  step?: {
    index: number; // 1-based
    total: number;
    description: string;
    completed: string[]; // descriptions of steps already implemented & committed
  };
}

export interface VerifyRequest {
  cwd: string;
  plan: string;
  diff: string;
  // Convergence context: which verify attempt this is for the current step and
  // what earlier attempts were rejected for. Reviewers use it to (a) check the
  // flagged defects are actually fixed and (b) stop surfacing brand-new minor
  // findings round after round (the whack-a-mole loop that burns retries).
  attempt?: number; // 1-based, global across rounds
  previousFailures?: string[]; // one entry per earlier rejected attempt
}

// Escalation: when a step keeps failing verification, the lead (호재/Opus) is
// asked to diagnose the root cause from the accumulated reviewer feedback + the
// current diff, and hand the builder concrete fix guidance for the next round.
export interface InterveneRequest {
  cwd: string;
  approvedPlan: string;
  stepDescription: string;
  index: number; // 1-based
  total: number;
  attempts: number; // how many build/verify attempts already failed
  failures: string[]; // each failing reviewer reason across the round
  diff: string; // the current (rejected) uncommitted diff
}

export interface CodexUsage {
  inputTokens: number; // uncached input
  outputTokens: number;
  cacheRead: number; // cached input tokens
}

export interface VerifyResult {
  passed: boolean;
  reason: string;
  raw: string;
  usage?: CodexUsage;
}

// ── Agent roles ───────────────────────────────────────────────────────────
// Split per capability (ISP) so the pipeline depends only on the role it uses,
// and any engine can be swapped behind these interfaces without touching the
// orchestration logic (DIP/OCP).
export interface Planner {
  plan(req: PlanRequest, reporter: PhaseReporter): Promise<AgentResult>;
  // Diagnose a repeatedly-failing step and return actionable fix guidance for
  // the builder (read-only; does not touch files).
  intervene(req: InterveneRequest, reporter: PhaseReporter): Promise<AgentResult>;
}

export interface Builder {
  build(req: BuildRequest, reporter: PhaseReporter): Promise<AgentResult>;
}

export interface Verifier {
  verify(req: VerifyRequest): Promise<VerifyResult>;
}

// A named reviewer that inspects the built diff and returns pass/fail. The
// pipeline runs an injected array of these in parallel (a fan-out), so adding a
// second code reviewer or a test-runner is just another array entry in the
// composition root — the pipeline policy is unchanged (OCP). A "test" reviewer
// (running the project's tests) is homomorphic to a code reviewer, so it wears
// the same interface and joins the same fan-out.
export interface Reviewer {
  readonly name: string; // display label, e.g. "codex", "tests"
  readonly kind: Extract<StepKind, "review" | "test">;
  readonly engine: string; // claude | codex | system (for badge + pricing bucket)
  readonly model: string; // model id for pricing; "-" when there's no model
  review(req: VerifyRequest): Promise<VerifyResult>;
}
