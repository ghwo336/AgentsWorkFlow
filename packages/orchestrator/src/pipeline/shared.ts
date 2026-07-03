import { REVIEWER_AGENT_ID, type RunRoster } from "@agent-loop/shared/roster";
import type { Reviewer, VerifyResult } from "../agents/types.js";
import type { RunReporter } from "../reporter.js";
import type { PipelineDeps } from "./types.js";

// Collaborators every pipeline mode shares: roster narrowing, step ordering,
// the plan step, and the reviewer fan-out. Pure orchestration helpers — each
// takes `deps` explicitly so modes stay stateless functions.

// The injected reviewer fan-out, narrowed to the run's selected 검증자들.
// (Reviewer.name is the identity key: 품질/보안/통합/빌드/tests.)
export function reviewersFor(deps: PipelineDeps, roster: RunRoster): Reviewer[] {
  return deps.reviewers.filter((r) => roster.reviewerNames.includes(r.name));
}

// Which selected builder takes this (global) attempt — retries hand off
// between the selected developers, matching the dashboard's seating rule.
// (단계에 담당이 배정된 경우엔 이 순환을 쓰지 않는다 — full.ts 참조.)
export function builderFor(roster: RunRoster, attempt: number): string | undefined {
  const ids = roster.builderIds;
  if (ids.length === 0) return undefined;
  return ids[(Math.max(1, attempt) - 1) % ids.length];
}

// Monotonic orderIdx generator that continues past any steps already stored for
// this run, so a resumed phase sorts after the earlier ones.
export async function resumeOrder(deps: PipelineDeps, runId: string): Promise<() => number> {
  let n = (await deps.store.getMaxOrderIdx(runId)) + 1;
  return () => n++;
}

// Store the agent's full summary (markdown structure preserved), not a clipped
// one-liner — the dashboard truncates for its collapsed preview and renders the
// full thing as markdown on expand, so "더보기" must have everything to show.
// Only collapse runs of blank lines and trim.
export function compactAgentSummary(text: string | undefined, fallback: string): string {
  const cleaned = (text ?? "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || fallback;
}

// ① PLAN (Opus) — returns the plan text, its step id, and the decomposed step
// list, or null on failure (already reported). The planner ADAPTER returns the
// plan parsed (steps/devs/team) — the fenced output format is its contract
// (agents/plan-format.ts). Used by the full pipeline and plan-only mode.
export async function planOnce(
  deps: PipelineDeps,
  brief: string,
  targetDir: string,
  reporter: RunReporter,
  order: () => number,
  opts: {
    previousPlan?: string;
    feedback?: string;
    suggestTeam?: boolean;
    assignableDevs?: Array<{ key: string; name: string; specialty?: string }>;
  } = {}
): Promise<{
  text: string;
  stepId: string;
  steps: string[];
  devs: (string | null)[];
  team: string[] | null;
} | null> {
  const { planner, config } = deps;
  const { previousPlan, feedback, suggestTeam, assignableDevs } = opts;
  const revising = !!feedback;
  await reporter.status("planning");
  const step = await reporter.startStep({
    kind: "plan",
    label: revising ? "계획 수정" : "계획",
    engine: "claude",
    model: config.planModel,
    agent: "hojae",
    orderIdx: order(),
  });
  await step.log(
    "plan",
    revising
      ? `피드백을 반영해 계획 수정 중 (${config.planModel})…`
      : `계획 수립 중 (${config.planModel})…`,
    { model: "opus" }
  );

  const result = await planner.plan(
    { brief, cwd: targetDir, previousPlan, feedback, suggestTeam, assignableDevs },
    step
  );
  if (result.isError || !result.text) {
    await step.finish("failed", "계획을 생성하지 못했습니다.");
    await reporter.status("failed", { error: "계획을 생성하지 못했습니다." });
    return null;
  }
  await step.log("plan", `계획을 ${result.steps.length}개 작업 단계로 분해했습니다.`, {
    model: "opus",
  });
  await step.finish("passed", compactAgentSummary(result.text, "승인용 구현 계획을 작성했습니다."));
  return { text: result.text, stepId: step.id, steps: result.steps, devs: result.devs, team: result.team };
}

export interface ReviewOutcome {
  reviewer: Reviewer;
  result: VerifyResult;
  stepId: string;
}

// Run every reviewer over the same diff in parallel, each as its own step.
// parentId is the build step in the normal loop, or null for a verify-only
// run's root-level audit.
export async function runReviewFanout(
  reporter: RunReporter,
  reviewers: Reviewer[],
  ctx: {
    approvedPlan: string;
    diff: string;
    cwd: string;
    attempt: number;
    previousFailures: string[];
    parentId: string | null;
    order: () => number;
  }
): Promise<ReviewOutcome[]> {
  return Promise.all(
    reviewers.map(async (reviewer) => {
      const label = reviewer.kind === "test" ? `테스트: ${reviewer.name}` : `리뷰: ${reviewer.name}`;
      const step = await reporter.startStep({
        kind: reviewer.kind,
        label,
        engine: reviewer.engine,
        model: reviewer.model,
        agent: REVIEWER_AGENT_ID[reviewer.name],
        attempt: ctx.attempt,
        parentId: ctx.parentId,
        orderIdx: ctx.order(),
      });
      // model carries the reviewer's identity key (품질/보안/통합/빌드) so the
      // dashboard can seat each log line with the right teammate — engine alone
      // can't tell the two codex reviewers apart.
      await step.log("verify", `${reviewer.name} 검토 중…`, { model: reviewer.name });
      const result = await reviewer.review({
        cwd: ctx.cwd,
        plan: ctx.approvedPlan,
        diff: ctx.diff,
        attempt: ctx.attempt,
        previousFailures: ctx.previousFailures,
      });
      await step.verdict(ctx.attempt, result.passed, result.reason, ctx.diff, result.raw);
      // Engines without a model (빌드 게이트/테스트 러너) simply never set usage.
      if (result.usage) {
        await step.usage({
          engine: reviewer.engine === "codex" ? "codex" : "claude",
          model: reviewer.model,
          phase: "verify",
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheRead: result.usage.cacheRead,
          cacheWrite: 0,
        });
      }
      await step.log(
        "verify",
        `${reviewer.name} ${result.passed ? "통과 ✅" : "거절 ❌"}: ${result.reason}`,
        { level: result.passed ? "info" : "warn", model: reviewer.name }
      );
      await step.finish(result.passed ? "passed" : "failed", result.reason);
      return { reviewer, result, stepId: step.id };
    })
  );
}
