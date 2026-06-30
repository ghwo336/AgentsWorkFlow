import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ClaudeBuilder, ClaudePlanner } from "./agents/claude-agent.js";
import { CodexVerifier } from "./agents/codex-agent.js";
import { ApprovalGate, type ApprovalDecision } from "./approval-gate.js";
import { config } from "./config.js";
import { git } from "./git.js";
import { RunPipeline } from "./pipeline.js";
import { DbRunReporter } from "./reporter.js";
import { RunStore } from "./run-store.js";

export interface StartInput {
  title: string;
  brief: string;
  project?: string; // logical project for grouping costs; defaults to "default"
  targetDir?: string; // existing repo to work in; omit for a fresh workspace
}

// ── Composition root ───────────────────────────────────────────────────────
// The only place that knows the concrete implementations; everything below the
// pipeline depends on abstractions. Swapping an engine = changing one line here.
const gate = new ApprovalGate();
const store = new RunStore();
const pipeline = new RunPipeline({
  planner: new ClaudePlanner(config.planModel),
  builder: new ClaudeBuilder(config.buildModel),
  verifier: new CodexVerifier(config.verdictSchemaPath),
  gate,
  git,
  store,
  config,
});

export async function startRun(input: StartInput): Promise<string> {
  const project = input.project?.trim() || "default";
  const { id } = await store.createRun({
    title: input.title,
    brief: input.brief,
    project,
  });

  const targetDir = input.targetDir ?? join(config.workspacesDir, id);
  await mkdir(targetDir, { recursive: true });
  await store.setTargetDir(id, targetDir);

  // Fire and forget; the pipeline drives itself and reports via events.
  const reporter = new DbRunReporter(id);
  pipeline.run(id, input.brief, targetDir, reporter).catch(async (err) => {
    await reporter.log("system", `치명적 오류: ${err?.message ?? err}`, { level: "error" });
    await reporter.status("failed", { error: String(err?.message ?? err) });
  });

  return id;
}

// Called by the HTTP layer when the user clicks Approve/Reject in the dashboard.
export function resolveApproval(runId: string, decision: ApprovalDecision): boolean {
  return gate.resolve(runId, decision);
}
