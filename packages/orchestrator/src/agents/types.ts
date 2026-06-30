import type { RunReporter } from "../reporter.js";

// Outcome of a Claude phase (plan or build).
export interface AgentResult {
  text: string;
  isError: boolean;
}

export interface PlanRequest {
  brief: string;
  cwd: string;
}

export interface BuildRequest {
  approvedPlan: string;
  brief: string;
  cwd: string;
  feedback?: string;
}

export interface VerifyRequest {
  cwd: string;
  plan: string;
  diff: string;
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
  plan(req: PlanRequest, reporter: RunReporter): Promise<AgentResult>;
}

export interface Builder {
  build(req: BuildRequest, reporter: RunReporter): Promise<AgentResult>;
}

export interface Verifier {
  verify(req: VerifyRequest): Promise<VerifyResult>;
}
