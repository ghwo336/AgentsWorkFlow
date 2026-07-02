// Pure derivation logic for the workspace's progress views: how raw Step spans
// are grouped into plan-step rows and how a step/row reads as an outcome badge.
// No React here — keep this testable and reusable by any view (table, pills,
// future visualizations) without dragging components along (SRP).

import { agentById, agentForStep, type Agent } from "../../lib/cast";
import type { RunDetail, Step } from "../../lib/types";

export const FLOW_ICON: Record<string, string> = {
  plan: "📋",
  build: "🔨",
  verify: "🔍",
  review: "🔍",
  test: "🧪",
  commit: "✅",
};

export function flowVerb(kind: string): string {
  switch (kind) {
    case "build":
      return "구현";
    case "verify":
    case "review":
      return "검증";
    case "test":
      return "테스트";
    case "commit":
      return "커밋";
    case "plan":
      return "기획";
    default:
      return kind;
  }
}

// Which plan step (1-based) a work-span belongs to. build/commit carry it in
// their label ("단계 N/M"); a verify/review/test span inherits it from its parent
// build via parentId.
function planStepNo(step: Step, byId: Map<string, Step>): number | null {
  const direct = step.label.match(/단계\s*(\d+)\s*\//);
  if (direct) return Number(direct[1]);
  let cur: Step | undefined = step;
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
    const m = cur?.label.match(/단계\s*(\d+)\s*\//);
    if (m) return Number(m[1]);
  }
  return null;
}

export function planStepTotal(steps: Step[]): number {
  for (const s of steps) {
    const m = s.label.match(/단계\s*\d+\s*\/\s*(\d+)/);
    if (m) return Number(m[1]);
  }
  return 0;
}

export type StepGroup = { no: number; steps: Step[] };

export function groupByPlanStep(steps: Step[]): StepGroup[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const map = new Map<number, Step[]>();
  for (const s of steps) {
    if (s.kind === "plan") continue;
    const no = planStepNo(s, byId);
    if (no == null) continue;
    (map.get(no) ?? map.set(no, []).get(no)!).push(s);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([no, list]) => ({ no, steps: list.sort((a, b) => a.orderIdx - b.orderIdx) }));
}

export type Tone = "passed" | "failed" | "running" | "pending";

export function toneFor(status: string): Tone {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "pending";
}

// The decomposed plan-step descriptions ("무엇을 하는지"), persisted on the run
// when the plan is approved. Available even before approval, so the table can
// show the whole roadmap upfront.
export function planStepDescriptions(detail: RunDetail): string[] {
  try {
    const raw = detail.planSteps;
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export type RowState = { icon: string; label: string; tone: Tone };

// A plan-step row's status, derived from its work-span group (if it has started).
export function planRowState(group: StepGroup | undefined): RowState {
  if (!group) return { icon: "•", label: "대기", tone: "pending" };
  if (group.steps.some((s) => s.kind === "commit" && s.status === "passed"))
    return { icon: "✅", label: "완료", tone: "passed" };
  if (group.steps.some((s) => s.status === "running"))
    return { icon: "⏳", label: "진행 중", tone: "running" };
  if (group.steps.some((s) => s.status === "failed"))
    return { icon: "🔁", label: "재시도 중", tone: "failed" };
  return { icon: "⏳", label: "진행 중", tone: "running" };
}

// Who's on the row: the actual builder once it starts, else 태경 as the default
// upcoming assignee.
export function planRowAgent(group: StepGroup | undefined): Agent {
  const build = group?.steps.find((s) => s.kind === "build");
  return build ? agentForStep(build) : agentById("taekyung");
}

// codex/infra execution failures (vs. a genuine review rejection). These mean
// "codex couldn't run", not "your code is wrong" — labelled distinctly so a
// transient failure isn't mistaken for a real defect.
const INFRA_FAIL =
  /(failed to run|could not parse|timed out|exceeded maxbuffer|reading additional input|무한\s*대기|실행(에|)\s*실패|stdin)/i;

export type Outcome = { icon: string; label: string; tone: string };

export function stepOutcome(step: Step, awaitingApproval = false): Outcome {
  const isVerify = step.kind === "verify" || step.kind === "review" || step.kind === "test";
  if (step.status === "running") return { icon: "⏳", label: isVerify ? "검토 중" : "진행 중", tone: "running" };
  if (step.status === "skipped") return { icon: "⏭️", label: "건너뜀", tone: "pending" };
  // Plan is done but not yet approved — signal it's a pending gate, not a
  // finished task (amber tone), so it doesn't read as "approved / done".
  if (awaitingApproval && step.kind === "plan" && step.status === "passed") {
    return { icon: "⏳", label: "기획 완료 · 승인 대기", tone: "running" };
  }
  if (isVerify) {
    if (step.status === "passed") return { icon: "✅", label: "통과 · 문제없음", tone: "passed" };
    if (step.status === "failed") {
      return step.summary && INFRA_FAIL.test(step.summary)
        ? { icon: "⚠️", label: "실행오류 · 검토못함", tone: "warn" }
        : { icon: "❌", label: "오류 지적", tone: "failed" };
    }
  }
  if (step.status === "passed") {
    if (step.kind === "plan") return { icon: "📋", label: "기획 완료", tone: "passed" };
    if (step.kind === "build") return { icon: "🔨", label: "구현 완료", tone: "passed" };
    if (step.kind === "commit") return { icon: "✅", label: "커밋", tone: "passed" };
    return { icon: "✅", label: "완료", tone: "passed" };
  }
  if (step.status === "failed") return { icon: "❌", label: "실패", tone: "failed" };
  return { icon: "•", label: "대기", tone: "pending" };
}
