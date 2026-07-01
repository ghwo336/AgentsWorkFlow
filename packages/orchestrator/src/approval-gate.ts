// The user's out-of-band decision on a pending plan. "revise" re-plans with the
// feedback (an interactive back-and-forth) instead of ending the run.
//
// The decision is applied by runner.resolveApproval, which reads the run's state
// from the DB rather than an in-memory gate — so a plan waiting for approval is
// not lost when the orchestrator restarts.
export type ApprovalDecision =
  | { action: "approve"; editedPlan?: string }
  | { action: "reject" }
  | { action: "revise"; feedback: string };
