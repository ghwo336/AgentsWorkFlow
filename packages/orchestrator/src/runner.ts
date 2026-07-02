import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ClaudeBuilder, ClaudePlanner } from "./agents/claude-agent.js";
import { CodexVerifier } from "./agents/codex-agent.js";
import { CommandReviewer } from "./agents/command-reviewer.js";
import type { InterventionDecision } from "@agent-loop/shared/types";
import type { Reviewer } from "./agents/types.js";
import type { ApprovalDecision } from "./approval-gate.js";
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
  workspaceName?: string; // name a fresh workspace folder instead of a random id
}

// Reduce a user-supplied workspace name to a safe single folder name — drop any
// path separators (no escaping workspacesDir) and leading dots, keep it tidy.
function sanitizeWorkspaceName(name: string): string {
  const base = name.trim().split(/[\\/]/).pop() ?? "";
  return base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^\.+/, "");
}

// A readable, filesystem-safe folder name from a project name — but Unicode-
// friendly (keeps Korean etc.), unlike sanitizeWorkspaceName. Only strips path
// separators / control / illegal chars and leading dots so "투두리스트" stays
// "투두리스트". Returns "" if nothing usable is left (caller falls back).
function projectDirName(project: string): string {
  const base = project.trim().split(/[\\/]/).pop() ?? "";
  return base
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .trim();
}

// ── Composition root ───────────────────────────────────────────────────────
// The only place that knows the concrete implementations; everything below the
// pipeline depends on abstractions. Swapping an engine = changing one line here.
const store = new RunStore();

// Reviewer fan-out. Add a reviewer here (another engine, a second code
// reviewer, a linter) and it shows up as a parallel node — the pipeline is
// unchanged (OCP). The optional test-runner is enabled by setting TEST_CMD.
const reviewers: Reviewer[] = [
  new CodexVerifier(config.verdictSchemaPath, config.codexModel),
  ...(config.testCmd ? [new CommandReviewer("tests", config.testCmd)] : []),
];

const pipeline = new RunPipeline({
  planner: new ClaudePlanner(config.planModel),
  builder: new ClaudeBuilder(config.buildModel),
  reviewers,
  git,
  store,
  config,
});

// Log a fatal pipeline error onto the run and mark it failed. Shared by the
// fire-and-forget plan/build kicks so an unexpected throw never goes silent.
function onFatal(reporter: DbRunReporter) {
  return async (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    await reporter.log("system", `치명적 오류: ${msg}`, { level: "error" });
    await reporter.status("failed", { error: msg });
  };
}

export async function startRun(input: StartInput): Promise<string> {
  const project = input.project?.trim() || "default";
  const { id } = await store.createRun({
    title: input.title,
    brief: input.brief,
    project,
  });

  // Precedence: explicit targetDir → per-run named workspace → project's
  // remembered default → the project's own folder (agent-workspaces/<project>).
  // In the last case we persist it as the project default so every run in the
  // project lands in — and accumulates within — one folder, with no path input.
  const named = input.workspaceName ? sanitizeWorkspaceName(input.workspaceName) : "";
  let targetDir = input.targetDir?.trim() || "";
  if (!targetDir && named) targetDir = join(config.workspacesDir, named);
  if (!targetDir) targetDir = (await store.getProjectDefaultDir(project)) || "";
  if (!targetDir) {
    targetDir = join(config.workspacesDir, projectDirName(project) || id);
    await store.setProjectDefaultDir(project, targetDir); // remember it for next time
  }
  await mkdir(targetDir, { recursive: true });
  await store.setTargetDir(id, targetDir);

  // Fire and forget: produce a plan and park at awaiting_approval. The pipeline
  // reports via events; the approval is resolved later from the DB.
  const reporter = new DbRunReporter(id);
  pipeline.plan(id, input.brief, targetDir, reporter).catch(onFatal(reporter));

  return id;
}

// Called by the HTTP layer when the user clicks Approve/Reject/Revise. Unlike
// the old in-memory gate, this reads the run's state from the DB — so a pending
// approval survives an orchestrator restart. Returns false (→ 409) only when the
// run isn't actually awaiting approval.
export async function resolveApproval(
  runId: string,
  decision: ApprovalDecision
): Promise<boolean> {
  const st = await store.getResumeState(runId);
  if (!st || st.status !== "awaiting_approval") return false;
  const reporter = new DbRunReporter(runId);

  if (decision.action === "reject") {
    await reporter.log("approval", "사용자가 계획을 거절했습니다.", { level: "warn" });
    await reporter.status("rejected", { error: "사용자가 계획을 거절했습니다." });
    return true;
  }

  if (decision.action === "revise") {
    await reporter.log("approval", `수정 요청: ${decision.feedback}`);
    // Re-plan with the prior plan + feedback; parks at awaiting_approval again.
    if (st.targetDir) {
      pipeline
        .plan(runId, st.brief, st.targetDir, reporter, {
          previousPlan: st.plan ?? undefined,
          feedback: decision.feedback,
        })
        .catch(onFatal(reporter));
    }
    return true;
  }

  // approve — persist any edits, then resume into the build phase from the DB.
  if (decision.editedPlan?.trim()) await store.savePlan(runId, decision.editedPlan.trim());
  await reporter.log("approval", "계획 승인됨. 구현을 시작합니다.");
  await reporter.status("building");
  pipeline.build(runId, reporter).catch(onFatal(reporter));
  return true;
}

// User intervention on a run parked at needs_input (a step stuck after retries +
// 호재 escalation). Mirrors resolveApproval's DB-first, restart-safe contract:
// returns false (→ 409) unless the run is actually awaiting input. Fire-and-
// forget resumes the build per the decision.
export async function resolveInput(
  runId: string,
  decision: InterventionDecision
): Promise<boolean> {
  const st = await store.getResumeState(runId);
  if (!st || st.status !== "needs_input") return false;
  const reporter = new DbRunReporter(runId);
  pipeline.resumeFromInput(runId, reporter, decision).catch(onFatal(reporter));
  return true;
}

// Re-open a run that ended (rejected/failed) or is parked (needs_input) and
// continue the build from where it stopped — pipeline.build resumes at the first
// not-yet-committed step, now with the full retry + 호재 escalation ladder. Needs
// an approved plan to resume; returns false (→ 409) otherwise.
const RESUMABLE = new Set(["rejected", "failed", "needs_input"]);
export async function retryRun(runId: string): Promise<boolean> {
  const st = await store.getResumeState(runId);
  if (!st || !RESUMABLE.has(st.status) || !st.targetDir || !st.plan) return false;
  const reporter = new DbRunReporter(runId);
  await reporter.log("approval", "사용자가 작업을 다시 진행합니다 — 멈춘 지점부터 재개합니다.");
  await reporter.status("building");
  pipeline.build(runId, reporter).catch(onFatal(reporter));
  return true;
}
