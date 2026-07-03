import { BuildGateReviewer } from "./agents/build-gate.js";
import { ClaudeBuilder, ClaudePlanner } from "./agents/claude-agent.js";
import { ClaudeReviewer } from "./agents/claude-reviewer.js";
import { CodexVerifier } from "./agents/codex-agent.js";
import { CommandReviewer } from "./agents/command-reviewer.js";
import { lensWithHarness, loadHarness } from "./agents/harness.js";
import { QUALITY_LENS, SECURITY_LENS } from "./agents/review-policy.js";
import { describeTeam, rosterOf, runModeOf, seatsOf } from "@agent-loop/shared/roster";
import type { InterventionDecision } from "@agent-loop/shared/types";
import type { Reviewer } from "./agents/types.js";
import type { ApprovalDecision } from "./approval-gate.js";
import { config } from "./config.js";
import { git } from "./git.js";
import { RunPipeline } from "./pipeline/index.js";
import { DbRunReporter } from "./reporter.js";
import { RunStore } from "./run-store.js";
import { resolveTargetDir } from "./workspace-path.js";

export interface StartInput {
  title: string;
  brief: string;
  project?: string; // logical project for grouping costs; defaults to "default"
  targetDir?: string; // existing repo to work in; omit for a fresh workspace
  workspaceName?: string; // name a fresh workspace folder instead of a random id
  // Participating roster SEAT keys ("build:minjae" — validated at the HTTP
  // boundary). The combo decides the pipeline mode: 기획 포함 → plan→승인→build,
  // 기획 생략 → 바로 build, 검증만 → 프로젝트 감사, 기획만 → 계획서만.
  // OMIT the field entirely for 자동 배치: the run starts with the full team and
  // 호재 staffs the actual team while planning (```team block → Run.agents).
  agents?: string[];
}

// ── Composition root ───────────────────────────────────────────────────────
// The only place that knows the concrete implementations; everything below the
// pipeline depends on abstractions. Swapping an engine = changing one line here.
const store = new RunStore();

// Per-agent harnesses (agents-config/<agentId>.md) — each teammate's personal
// specialty rules, appended to their shared role prompt (system prompt or
// reviewer lens; both formats come from agents/harness.ts). Missing file = no-op.
const harnessOf = (agentId: string) => loadHarness(agentId);

// Reviewer fan-out. Add a reviewer here (another engine, a second code
// reviewer, a linter) and it shows up as a parallel node — the pipeline is
// unchanged (OCP). The optional test-runner is enabled by setting TEST_CMD.
// Each reviewer's `name` is its identity key: it appears in step labels
// (리뷰: 품질), commit messages, and maps to a fixed teammate in the dashboard.
//   품질(주호, codex)   — 정확성 + 소프트웨어 공학 원칙(SOLID/DRY/계층)
//   보안(동환, codex)   — 보안 전담 감사
//   통합(유준, claude)  — 런타임/배선이 실제로 동작하는지
//   빌드(성호, system)  — 빌드/타입체크 실제 실행 (무료·결정적)
const reviewers: Reviewer[] = [
  new CodexVerifier(config.verdictSchemaPath, config.codexModel, {
    name: "품질",
    lens: lensWithHarness(QUALITY_LENS, harnessOf("juho"), "주호"),
  }),
  new CodexVerifier(config.verdictSchemaPath, config.codexModel, {
    name: "보안",
    lens: lensWithHarness(SECURITY_LENS, harnessOf("donghwan"), "동환"),
  }),
  new ClaudeReviewer(config.reviewModel, harnessOf("yujun")),
  new BuildGateReviewer(),
  ...(config.testCmd ? [new CommandReviewer("tests", config.testCmd)] : []),
];

// One builder per developer, each armed with that person's specialty harness
// (태경=프론트엔드, 민재=백엔드, 주희=iOS, 성민=Android, 연한=RN). The plain
// `builder` stays as the fallback for legacy runs with no stamped assignee.
const buildersById = Object.fromEntries(
  seatsOf("build").map((s) => [
    s.agentId,
    new ClaudeBuilder(config.buildModel, harnessOf(s.agentId), s.name),
  ])
);

const pipeline = new RunPipeline({
  planner: new ClaudePlanner(config.planModel, harnessOf("hojae")),
  builder: new ClaudeBuilder(config.buildModel),
  buildersById,
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
  const agents = input.agents?.length ? input.agents : null;
  // 팀 미지정 = 자동 배치: 호재가 계획하며 ```team 블록으로 팀을 확정한다.
  const autoTeam = agents === null;
  const { id } = await store.createRun({
    title: input.title,
    brief: input.brief,
    project,
    agents,
    autoTeam,
  });

  // Where this run works — the path policy lives in workspace-path.ts.
  const targetDir = await resolveTargetDir({
    store,
    workspacesDir: config.workspacesDir,
    project,
    runId: id,
    targetDir: input.targetDir,
    workspaceName: input.workspaceName,
  });
  await store.setTargetDir(id, targetDir);

  // Fire and forget: the selected team decides the pipeline mode. The pipeline
  // reports via events; any approval is resolved later from the DB.
  const reporter = new DbRunReporter(id);
  const roster = rosterOf(agents);
  if (agents) {
    await reporter.log("system", `참여 에이전트: ${describeTeam(agents)}`);
  } else {
    await reporter.log("system", "팀 미지정 — 호재가 기획하면서 알맞은 팀을 배치합니다.");
  }
  switch (runModeOf(roster)) {
    case "verifyOnly": // 검증자만 — 프로젝트 현재 상태 감사
      pipeline.verifyOnly(id, input.brief, targetDir, reporter, roster).catch(onFatal(reporter));
      break;
    case "planOnly": // 기획만 — 계획서 작성 후 종료
      pipeline.planOnly(id, input.brief, targetDir, reporter).catch(onFatal(reporter));
      break;
    case "direct": // 기획 생략 — 승인 없이 바로 구현 (검증은 선택된 만큼)
      pipeline.directBuild(id, input.brief, targetDir, reporter).catch(onFatal(reporter));
      break;
    case "full": // 기본 — 계획 → 승인 → 구현/검증. 자동 배치 run이면 호재가
      // 팀도 추천하고, 단계별 담당 개발자는 두 모드 모두 계획에서 배정된다.
      pipeline
        .plan(id, input.brief, targetDir, reporter, {
          suggestTeam: autoTeam,
          builderIds: roster.builderIds,
        })
        .catch(onFatal(reporter));
      break;
  }

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
    // 자동 배치 run은 수정된 계획에 맞춰 팀도 다시 추천된다.
    if (st.targetDir) {
      pipeline
        .plan(runId, st.brief, st.targetDir, reporter, {
          previousPlan: st.plan ?? undefined,
          feedback: decision.feedback,
          suggestTeam: st.autoTeam,
          // 자동 배치 run은 재추천이 팀을 다시 정하므로 전원을 배정 후보로.
          builderIds: st.autoTeam ? rosterOf(null).builderIds : rosterOf(st.agents).builderIds,
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
  if (!st || !RESUMABLE.has(st.status) || !st.targetDir) return false;
  const reporter = new DbRunReporter(runId);

  // 검증 전용 run은 재개할 빌드가 없다 — 감사를 처음부터 다시 실행.
  const roster = rosterOf(st.agents);
  if (runModeOf(roster) === "verifyOnly") {
    await reporter.log("approval", "사용자가 프로젝트 감사를 다시 실행합니다.");
    pipeline.verifyOnly(runId, st.brief, st.targetDir, reporter, roster).catch(onFatal(reporter));
    return true;
  }

  if (!st.plan) return false;
  await reporter.log("approval", "사용자가 작업을 다시 진행합니다 — 멈춘 지점부터 재개합니다.");
  await reporter.status("building");
  pipeline.build(runId, reporter).catch(onFatal(reporter));
  return true;
}
