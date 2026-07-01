// The user's out-of-band decision on a pending plan. "revise" re-plans with the
// feedback (an interactive back-and-forth) instead of ending the run.
export type ApprovalDecision =
  | { action: "approve"; editedPlan?: string }
  | { action: "reject" }
  | { action: "revise"; feedback: string };

// Human-in-the-loop gate. The pipeline awaits a decision; the HTTP layer
// resolves it when the user clicks Approve/Reject/Revise in the dashboard.
// Single responsibility = bridge the async pause to the out-of-band web action.
export class ApprovalGate {
  private readonly pending = new Map<string, (d: ApprovalDecision) => void>();

  wait(runId: string): Promise<ApprovalDecision> {
    return new Promise((resolve) => this.pending.set(runId, resolve));
  }

  // Returns false if no run is awaiting approval under that id.
  resolve(runId: string, decision: ApprovalDecision): boolean {
    const resolver = this.pending.get(runId);
    if (!resolver) return false;
    this.pending.delete(runId);
    resolver(decision);
    return true;
  }
}
