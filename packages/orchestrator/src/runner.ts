import { BuildGateReviewer } from "./agents/build-gate.js";
import { ClaudeBuilder, ClaudePlanner } from "./agents/claude-agent.js";
import { ClaudeResearcher } from "./agents/claude-researcher.js";
import { ClaudeReviewer } from "./agents/claude-reviewer.js";
import { CodexVerifier } from "./agents/codex-agent.js";
import { CommandReviewer } from "./agents/command-reviewer.js";
import { lensWithHarness, loadHarness } from "./agents/harness.js";
import { GrokResearcher } from "./agents/grok-agent.js";
import { ensureLearnedDirs } from "./agents/learn-store.js";
import { ClaudeReflector } from "./agents/reflector.js";
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
  // 후속 작업의 부모 run id — 요구사항 스레드 링크 (독립 작업이면 생략).
  parentRunId?: string;
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

// 팀 학습 노트 디렉터리 골격 (agents-config/learned/) — 사용자가 파일을 직접
// 열어 고치기 쉽도록 부팅 시 만들어 둔다.
ensureLearnedDirs();

const pipeline = new RunPipeline({
  planner: new ClaudePlanner(config.planModel, harnessOf("hojae")),
  builder: new ClaudeBuilder(config.buildModel),
  buildersById,
  reviewers,
  // 리서치 팬아웃 — 리서치 run은 선택된 리서처 전원이 동시에 조사한다.
  //   상현(Grok Build CLI, X 구독 OAuth) — X 실시간 검색 전담 (search_x)
  //   예림(Claude Opus)                — X 밖 웹 전반 (문서/구글/레딧/매체)
  researchers: [
    {
      agentId: "sanghyun",
      name: "상현",
      engine: "grok",
      model: "grok",
      researcher: new GrokResearcher(config.grokBin, harnessOf("sanghyun")),
    },
    {
      agentId: "yerim",
      name: "예림",
      engine: "claude",
      model: config.researchModel,
      researcher: new ClaudeResearcher(config.researchModel, harnessOf("yerim")),
    },
  ],
  // 회고 — run 종료 후 실패 이력에서 교훈을 뽑아 학습 노트/제안함에 쌓는다.
  reflector: new ClaudeReflector(config.reflectModel),
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
    parentRunId: input.parentRunId,
  });

  // Where this run works — the path/allowlist policy lives in workspace-path.ts.
  // The HTTP layer pre-validates explicit dirs (→ 400); this is the backstop,
  // so a disallowed path that slips through fails the run instead of running.
  let targetDir: string;
  try {
    targetDir = await resolveTargetDir({
      store,
      workspacesDir: config.workspacesDir,
      allowedRoots: config.allowedTargetRoots,
      project,
      runId: id,
      targetDir: input.targetDir,
      workspaceName: input.workspaceName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reporter = new DbRunReporter(id);
    await reporter.log("system", `작업 폴더 오류: ${msg}`, { level: "error" });
    await reporter.status("failed", { error: msg });
    throw err;
  }
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
    case "research": // 리서치 — 리서처들이 동시에 조사해 보고서 작성 후 종료
      pipeline.research(id, input.brief, targetDir, reporter, roster).catch(onFatal(reporter));
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
  // 편집 반영은 내용이 실제로 달라졌을 때만 — 패널은 항상 editedPlan을 실어
  // 보내므로, 무조건 저장하면 승인마다 가짜 "직접 수정" 이력이 쌓인다.
  const edited = decision.editedPlan?.trim();
  if (edited && edited !== (st.plan ?? "").trim()) {
    await store.savePlan(runId, edited);
    await store.savePlanRevision(runId, edited, { kind: "edit" });
  }
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

// 리서치 run에 후속 질문을 잇는다 — 보고서가 나온(reported, 구버전 committed)
// run이나 실패한 run에서만. 조사 중(researching)에는 409. 이전 스레드를 맥락
// 삼아 같은 run에 새 보고서를 이어 붙인다.
const FOLLOWUP_OK = new Set(["reported", "committed", "failed"]);
export async function followUpResearch(
  runId: string,
  question: string,
  agents?: string[]
): Promise<boolean> {
  const st = await store.getResumeState(runId);
  if (!st || !st.targetDir) return false;
  const baseRoster = rosterOf(st.agents);
  if (runModeOf(baseRoster) !== "research") return false;
  if (!FOLLOWUP_OK.has(st.status)) return false;
  // 이 질문만 다른 리서처 조합으로 물을 수 있다 — 넘어온 seat이 리서처들로만
  // 이뤄졌을 때만 채택하고, 아니면 run의 원래 로스터로 답한다 (방어적).
  const override = agents ? rosterOf(agents) : null;
  const roster = override && runModeOf(override) === "research" ? override : baseRoster;
  const reporter = new DbRunReporter(runId);
  pipeline.researchFollowUp(runId, question, st.targetDir, reporter, roster).catch(onFatal(reporter));
  return true;
}

// Re-open a run that ended (rejected/failed) or is parked (needs_input) and
// continue the build from where it stopped — pipeline.build resumes at the first
// not-yet-committed step, now with the full retry + 호재 escalation ladder.
// 계획이 아직 없는 run(기획 도중 재시작 등으로 죽음)은 빌드 대신 기획을 처음부터
// 다시 시작한다 — 예전엔 이 경우 409를 돌려줘 재개 버튼이 막혔다.
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

  // 리서치 run도 재개할 빌드가 없다 — 조사를 처음부터 다시 실행.
  if (runModeOf(roster) === "research") {
    await reporter.log("research", "사용자가 리서치를 다시 실행합니다.");
    pipeline.research(runId, st.brief, st.targetDir, reporter, roster).catch(onFatal(reporter));
    return true;
  }

  // 계획이 없으면 기획 단계에서 죽은 것 — 기획부터 다시. (direct는 시작 시
  // brief가 plan으로 저장되므로 여기 오면 full/planOnly뿐이다.)
  if (!st.plan) {
    const mode = runModeOf(roster);
    if (mode !== "full" && mode !== "planOnly") return false;
    await reporter.log("approval", "사용자가 작업을 다시 진행합니다 — 기획을 다시 시작합니다.");
    if (mode === "planOnly") {
      pipeline.planOnly(runId, st.brief, st.targetDir, reporter).catch(onFatal(reporter));
    } else {
      pipeline
        .plan(runId, st.brief, st.targetDir, reporter, {
          suggestTeam: st.autoTeam,
          // 자동 배치 run은 호재가 팀을 다시 정하므로 전원을 배정 후보로.
          builderIds: st.autoTeam ? rosterOf(null).builderIds : roster.builderIds,
        })
        .catch(onFatal(reporter));
    }
    return true;
  }

  await reporter.log("approval", "사용자가 작업을 다시 진행합니다 — 멈춘 지점부터 재개합니다.");
  await reporter.status("building");
  pipeline.build(runId, reporter).catch(onFatal(reporter));
  return true;
}
