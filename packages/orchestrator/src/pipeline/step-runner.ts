import { REVIEWER_AGENT_ID, type RunRoster } from "@agent-loop/shared/roster";
import { loadAgentLessons, loadProjectLessons } from "../agents/learn-store.js";
import type { RunReporter } from "../reporter.js";
import { reflectAndLearn } from "./reflection.js";
import {
  builderFor,
  compactAgentSummary,
  reviewersFor,
  runReviewFanout,
  type ReviewOutcome,
} from "./shared.js";
import type { PipelineDeps } from "./types.js";

// The per-step build/verify/commit loop with the 호재 escalation ladder — the
// heart of every build-mode run. full.ts (초기 빌드)와 intervention.ts (사용자
// 개입 후 재개)가 executeSteps로 진입한다.

// ②③④ Walk the plan step by step from `startIdx`. Each step is implemented
// (Sonnet), verified (codex) and committed on its own; a step that keeps
// failing escalates to 호재 (Opus) and, if still stuck, parks the run at
// needs_input for the user instead of killing the whole run.
export async function executeSteps(
  deps: PipelineDeps,
  args: {
    runId: string;
    approvedPlan: string;
    steps: string[];
    stepDevs?: (string | null)[]; // 단계별 담당 개발자 (계획에서 배정)
    brief: string;
    targetDir: string;
    project: string; // 팀 학습 노트 스코프 키
    reporter: RunReporter;
    order: () => number;
    roster: RunRoster;
    seedParentId: string;
    startIdx: number;
    seedFeedbackForFirst?: string;
  }
): Promise<void> {
  const { runId, approvedPlan, steps, brief, targetDir, reporter, order, roster } = args;
  const { git } = deps;
  // 이 프로젝트에서 팀이 배운 것 — run 시작마다 새로 읽어(직전 run의 회고가
  // 바로 반영되도록) 모든 빌드 프롬프트에 주입한다.
  const projectLearned = loadProjectLessons(args.project);
  // Chain parent: the first (resumed) step hangs off seedParentId (plan step,
  // or the previous step's commit); each next step hangs off the previous
  // step's commit, so the node graph is one connected spine.
  let parentId = args.seedParentId;
  let lastSha = "";
  const completed = steps.slice(0, args.startIdx);
  // 회고용 이력 — 단계마다 (설명, 거절 사유들)을 모아 run 종료 후 넘긴다.
  const stepHistory: Array<{ description: string; failures: string[] }> = [];

  for (let i = args.startIdx; i < steps.length; i++) {
    const outcome = await runStep(deps, {
      runId,
      approvedPlan,
      brief,
      targetDir,
      projectLearned,
      reporter,
      order,
      roster,
      parentId,
      description: steps[i],
      assignedDev: args.stepDevs?.[i] ?? undefined,
      index: i + 1,
      total: steps.length,
      completed: [...completed],
      seedFeedback: i === args.startIdx ? args.seedFeedbackForFirst : undefined,
    });
    stepHistory.push({ description: steps[i], failures: outcome.failures });

    if (!outcome.passed) {
      await reporter.status("needs_input", {
        error: `단계 ${i + 1}/${steps.length}이(가) 재시도${roster.planner ? "와 호재(Opus) 개입" : ""} 후에도 검증을 통과하지 못했습니다. 마지막 사유: ${outcome.feedback ?? "-"}`,
      });
      return;
    }
    parentId = outcome.lastStepId;
    if (outcome.sha) lastSha = outcome.sha;
    completed.push(steps[i]);
  }

  const finalSha = lastSha || (await git.headSha(targetDir));
  await reporter.status("committed", { commit: finalSha });
  await reporter.log(
    "commit",
    `모든 단계(${steps.length}개) 완료 ✅ 최종 커밋 ${finalSha.slice(0, 10)}`
  );

  // 회고 — run 완료 후 이번 run의 실패 이력에서 교훈을 추출해 학습 노트에
  // 쌓는다. run은 이미 committed로 마감됐으므로 여기 실패는 run에 영향 없음.
  await reflectAndLearn(deps, {
    runId,
    project: args.project,
    brief,
    plan: approvedPlan,
    targetDir,
    builderIds: roster.builderIds,
    steps: stepHistory,
    reporter,
    order,
  });
}

interface StepCtx {
  runId: string;
  approvedPlan: string;
  brief: string;
  targetDir: string;
  projectLearned?: string; // 프로젝트 학습 노트 (run 시작에 한 번 로드)
  reporter: RunReporter;
  order: () => number;
  roster: RunRoster;
  parentId: string;
  description: string;
  assignedDev?: string; // 이 단계의 담당 개발자 person id (계획에서 배정)
  index: number;
  total: number;
  completed: string[];
  seedFeedback?: string;
}

// One plan step with the escalation ladder: round 1 (builders retry up to
// maxVerifyRetries) → 호재(Opus) intervention → round 2 (builders retry again,
// armed with the lead's guidance). Still failing → not passed (→ needs_input).
async function runStep(
  deps: PipelineDeps,
  ctx: StepCtx
): Promise<{ passed: boolean; lastStepId: string; sha: string; feedback?: string; failures: string[] }> {
  const { config } = deps;
  const { reporter } = ctx;
  const tag = `단계 ${ctx.index}/${ctx.total}`;

  // Round 1 — builders try on their own (seeded with the user's guidance if
  // this is a post-intervention resume).
  const r1 = await runStepRound(deps, ctx, { seedFeedback: ctx.seedFeedback, attemptOffset: 0 });
  if (r1.passed) return r1;

  // 호재가 팀에 없으면 에스컬레이션 라운드가 없다 — 바로 사용자 개입으로.
  if (!ctx.roster.planner) {
    await reporter.log(
      "verify",
      `${tag}: 검증을 통과하지 못했습니다 — 기획 에이전트(호재)가 없어 바로 사용자 개입을 기다립니다.`,
      { level: "error" }
    );
    return { passed: false, lastStepId: r1.lastStepId, sha: "", feedback: r1.feedback, failures: r1.failures };
  }

  // Escalate to 호재 (Opus): diagnose the repeated failures + hand the builder
  // concrete guidance for the next round.
  const escal = await escalate(deps, ctx, r1);

  // Round 2 — same builders, now following the lead's fix plan. Reviewers get
  // round 1's rejections as history so they converge instead of re-litigating.
  const r2 = await runStepRound(
    deps,
    { ...ctx, parentId: escal.stepId },
    {
      seedFeedback: escal.guidance,
      attemptOffset: config.maxVerifyRetries,
      previousFailures: r1.failures,
    }
  );
  if (r2.passed) return r2;

  await reporter.log(
    "verify",
    `${tag}: 호재 개입 후에도 검증을 통과하지 못했습니다 — 사용자 개입을 기다립니다.`,
    { level: "error" }
  );
  // r2.failures는 previousFailures 시딩으로 r1의 사유까지 포함한 전체 이력이다.
  return { passed: false, lastStepId: r2.lastStepId, sha: "", feedback: r2.feedback, failures: r2.failures };
}

// 호재(Opus) steps in when a step keeps failing: reads the diff + failures and
// returns actionable guidance. Emits a 호재 (plan-kind) step so it shows inline
// in the step's flow. Read-only — never touches files.
async function escalate(
  deps: PipelineDeps,
  ctx: Pick<StepCtx, "approvedPlan" | "targetDir" | "reporter" | "order" | "description" | "index" | "total">,
  round1: { lastStepId: string; failures: string[] }
): Promise<{ guidance: string; stepId: string }> {
  const { planner, git, config } = deps;
  const { reporter, targetDir } = ctx;
  const tag = `단계 ${ctx.index}/${ctx.total}`;
  const step = await reporter.startStep({
    kind: "plan",
    label: `${tag} · 호재 개입`,
    engine: "claude",
    model: config.planModel,
    agent: "hojae",
    attempt: config.maxVerifyRetries,
    parentId: round1.lastStepId,
    orderIdx: ctx.order(),
  });
  await step.log(
    "plan",
    `${tag}가 ${config.maxVerifyRetries}번 실패 — 호재(Opus)가 원인을 분석해 해결책을 제시합니다…`,
    { model: "opus" }
  );
  const diff = await git.uncommittedDiff(targetDir);
  const res = await planner.intervene(
    {
      cwd: targetDir,
      approvedPlan: ctx.approvedPlan,
      stepDescription: ctx.description,
      index: ctx.index,
      total: ctx.total,
      attempts: config.maxVerifyRetries,
      failures: round1.failures,
      diff,
    },
    step
  );
  const guidance =
    res.text?.trim() ||
    "이전 실패 원인을 근본적으로 다시 점검하고, 검증자의 지적을 정확히 해결하세요.";
  await step.finish(res.isError ? "failed" : "passed", compactAgentSummary(guidance, "해결책을 제시했습니다."));
  // 💬 호재 drops into the chat with the fix plan for the builders.
  await reporter.chat({
    role: "plan",
    attempt: config.maxVerifyRetries,
    kind: "escalate",
    toRole: "build",
    stepLabel: `단계 ${ctx.index}/${ctx.total}`,
    agent: "hojae",
    text: guidance,
  });
  return { guidance, stepId: step.id };
}

// One round of BUILD (Sonnet, this step only) → VERIFY (codex) → COMMIT,
// retrying up to maxVerifyRetries with the reviewer's reason fed back. Returns
// the commit sha + tail step id on pass, or the accumulated failure reasons.
async function runStepRound(
  deps: PipelineDeps,
  ctx: StepCtx,
  opts: { seedFeedback?: string; attemptOffset: number; previousFailures?: string[] }
): Promise<{ passed: boolean; lastStepId: string; sha: string; feedback?: string; failures: string[] }> {
  const { git, config } = deps;
  // 검증자 0명이어도 빌드 게이트는 강제 — "리뷰 생략"이 "빌드도 안 해보고 커밋"이
  // 되지 않도록 (검증 생략은 LLM 리뷰에만 해당한다).
  const reviewers = reviewersFor(deps, ctx.roster, { ensureBuildGate: true });
  const { reporter, targetDir, order } = ctx;
  const tag = `단계 ${ctx.index}/${ctx.total}`;
  let feedback: string | undefined = opts.seedFeedback;
  let parentId = ctx.parentId;
  // Seeded with the prior round's rejections (if any) so reviewers see the
  // whole rejection history for this step, not just this round's.
  const failures: string[] = [...(opts.previousFailures ?? [])];

  for (let n = 1; n <= config.maxVerifyRetries; n++) {
    const attempt = opts.attemptOffset + n; // global attempt no. (round 2 → 6..10)
    // 담당 배정이 있으면 재시도 포함 모든 attempt를 그 전문가가 잡는다 —
    // 스택이 맞는 사람이 계속 파는 것이, 무관한 전문가에게 넘기는 것보다 낫다.
    // 배정이 없을 때만 (레거시/기획 생략) attempt 순환으로 교대.
    const builderId =
      ctx.assignedDev && ctx.roster.builderIds.includes(ctx.assignedDev)
        ? ctx.assignedDev
        : builderFor(ctx.roster, attempt);
    // The assigned teammate's own builder (their specialty harness); fall back
    // to the generic builder for unknown/legacy ids.
    const builder = (builderId && deps.buildersById?.[builderId]) || deps.builder;
    // ② BUILD (auto-approved, scoped to this step)
    await reporter.status("building");
    const buildStep = await reporter.startStep({
      kind: "build",
      label: `${tag} · 빌드${attempt > 1 ? ` (시도 ${attempt})` : ""}`,
      engine: "claude",
      model: config.buildModel,
      agent: builderId,
      attempt,
      parentId,
      orderIdx: order(),
    });
    await buildStep.log("build", `${tag} 구현 중 (${config.buildModel})…`, { model: "sonnet" });

    // 학습 주입 = 프로젝트 노트(자동 축적) + 이 빌더의 승인된 개인 교훈.
    // 개인 교훈은 담당자가 attempt마다 바뀔 수 있어 여기서 조합한다.
    const learned =
      [ctx.projectLearned, builderId ? loadAgentLessons(builderId) : undefined]
        .filter(Boolean)
        .join("\n") || undefined;
    const buildResult = await builder.build(
      {
        approvedPlan: ctx.approvedPlan,
        brief: ctx.brief,
        cwd: targetDir,
        feedback,
        learned,
        step: {
          index: ctx.index,
          total: ctx.total,
          description: ctx.description,
          completed: ctx.completed,
        },
      },
      buildStep
    );
    if (buildResult.isError) {
      await buildStep.log("build", "빌드 에이전트에서 오류가 발생했습니다.", { level: "warn" });
    }

    if (!(await git.hasChanges(targetDir))) {
      await buildStep.log("build", "변경된 파일이 없습니다.", { level: "warn" });
      await buildStep.finish("failed", "변경 없음");
      feedback = "이전 시도에서 아무 변경도 만들지 않았습니다. 이 단계를 실제로 구현하세요.";
      parentId = buildStep.id;
      continue;
    }
    const buildSummary = compactAgentSummary(buildResult.text, `${tag}를 구현했습니다.`);
    await buildStep.finish("passed", buildSummary);
    // 💬 builder tells the verifiers what it did (team chat).
    await reporter.chat({
      role: "build",
      attempt,
      kind: "build",
      toRole: "verify",
      stepLabel: tag,
      agent: builderId,
      text: buildSummary,
    });

    // ③ VERIFY — codex reviews THIS step's uncommitted diff (previous steps
    // are already committed, so the diff is exactly this step's changes).
    await reporter.status("verifying");
    const diff = await git.uncommittedDiff(targetDir);
    const stepPlan = `${ctx.approvedPlan}\n\n=== 지금 검증할 단계 (${ctx.index}/${ctx.total}) ===\n${ctx.description}`;
    const reviews: ReviewOutcome[] = await runReviewFanout(reporter, reviewers, {
      approvedPlan: stepPlan,
      diff,
      cwd: targetDir,
      attempt,
      previousFailures: failures.slice(),
      parentId: buildStep.id,
      order,
    });

    const passed =
      reviews.length > 0 &&
      (config.reviewPolicy === "any"
        ? reviews.some((r) => r.result.passed)
        : reviews.every((r) => r.result.passed));
    const lastReviewStepId = reviews[reviews.length - 1]?.stepId ?? buildStep.id;

    await notifyVerdicts(reporter, reviews, attempt, tag);

    // ④ COMMIT this step (on PASS) and move on.
    if (passed) {
      const committed = await commitStep(deps, ctx, { reviews, attempt, parentId: lastReviewStepId });
      return { passed: true, lastStepId: committed.stepId, sha: committed.sha, failures };
    }

    // Feed every failing reviewer's reason back into the next attempt.
    feedback = reviews
      .filter((r) => !r.result.passed)
      .map((r) => `[${r.reviewer.name}] ${r.result.reason}`)
      .join("\n\n");
    failures.push(feedback);
    parentId = lastReviewStepId;
  }

  return { passed: false, lastStepId: parentId, sha: "", feedback, failures };
}

// 💬 each reviewer replies to the builder with its verdict (team chat).
// The reviewer's identity key (name: 품질/보안/통합/빌드) rides in `engine`
// so the dashboard seats the turn with the right teammate — two codex
// reviewers share an engine, so engine alone is ambiguous.
async function notifyVerdicts(
  reporter: RunReporter,
  reviews: ReviewOutcome[],
  attempt: number,
  tag: string
): Promise<void> {
  for (const r of reviews) {
    await reporter.chat({
      role: "verify",
      attempt,
      kind: "verify",
      toRole: "build",
      stepLabel: tag,
      passed: r.result.passed,
      engine: r.reviewer.name,
      agent: REVIEWER_AGENT_ID[r.reviewer.name],
      text: r.result.reason,
    });
  }
}

// Commit a verified step: commit node + git commit + timeline log + team chat.
async function commitStep(
  deps: PipelineDeps,
  ctx: StepCtx,
  args: { reviews: ReviewOutcome[]; attempt: number; parentId: string }
): Promise<{ stepId: string; sha: string }> {
  const { git, store } = deps;
  const { reporter, targetDir, order } = ctx;
  const tag = `단계 ${ctx.index}/${ctx.total}`;
  const step = await reporter.startStep({
    kind: "commit",
    label: `${tag} · 커밋`,
    parentId: args.parentId,
    attempt: args.attempt,
    orderIdx: order(),
  });
  const title = (await store.getTitle(ctx.runId)) ?? "agent-loop change";
  const reviewerNames = args.reviews.map((r) => r.reviewer.name).join(", ");
  const message = `${title} — ${tag}\n\n${ctx.description}\n\nVerified by ${reviewerNames} (attempt ${args.attempt}).`;
  const sha = await git.commitAll(targetDir, message);
  await step.finish("passed", `${tag} 검증 통과 후 ${sha.slice(0, 10)} 커밋.`);
  await reporter.log(
    "commit",
    `${tag} 커밋 ${sha.slice(0, 10)} ✅ (${reviewerNames} 통과, ${args.attempt}번째 시도)`
  );
  await reporter.chat({
    role: "system",
    attempt: args.attempt,
    kind: "commit",
    stepLabel: tag,
    text: `${reviewerNames} 통과 → ${sha.slice(0, 10)} 커밋 완료.`,
  });
  return { stepId: step.id, sha };
}
