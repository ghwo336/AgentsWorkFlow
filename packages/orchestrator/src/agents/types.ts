import type { PhaseReporter } from "../reporter.js";
import type { StepKind } from "@agent-loop/shared/types";

// Outcome of a Claude phase (plan or build).
export interface AgentResult {
  text: string;
  isError: boolean;
}

// A plan, already parsed into structure by the planner ADAPTER — the fenced
// ```steps/```team output format is the adapter's contract with its prompt
// (agents/plan-format.ts); the pipeline only consumes this structure.
export interface PlanResult extends AgentResult {
  // text = 승인 UI용 계획 본문 (machine 블록 제거됨)
  steps: string[];
  devs: (string | null)[]; // 단계별 담당 개발자 person id (미배정 = null)
  team: string[] | null; // 자동 배치 run에서 호재가 추천한 좌석 키
}

export interface PlanRequest {
  brief: string;
  cwd: string;
  // 팀 학습 노트(learn-store)에서 온, 이 run에 적용되는 교훈 불릿 — 프롬프트에
  // 그대로 주입된다. 없으면 학습된 것이 없는 것.
  learned?: string;
  // For an interactive revision: the plan being revised + the user's requested
  // changes. When set, the planner revises rather than starting from scratch.
  previousPlan?: string;
  feedback?: string;
  // Auto-team run: the planner must also staff the team — append a ```team
  // block recommending which developers/verifiers fit this request.
  suggestTeam?: boolean;
  // Developers available for step assignment (seat key + specialty). When set,
  // every ```steps item must be {"desc", "dev"} — the planner matches each step
  // to the specialist whose stack fits it (프론트 단계→태경, API 단계→민재, …).
  assignableDevs?: Array<{ key: string; name: string; specialty?: string }>;
}

export interface BuildRequest {
  approvedPlan: string;
  brief: string;
  cwd: string;
  feedback?: string;
  // 프로젝트 학습 노트 + 이 빌더의 승인된 교훈 (learn-store) — 프롬프트 주입용.
  learned?: string;
  // When set, the builder implements ONLY this one step of the plan, with the
  // already-completed steps given as context.
  step?: {
    index: number; // 1-based
    total: number;
    description: string;
    completed: string[]; // descriptions of steps already implemented & committed
  };
}

export interface VerifyRequest {
  cwd: string;
  plan: string;
  diff: string;
  // Convergence context: which verify attempt this is for the current step and
  // what earlier attempts were rejected for. Reviewers use it to (a) check the
  // flagged defects are actually fixed and (b) stop surfacing brand-new minor
  // findings round after round (the whack-a-mole loop that burns retries).
  attempt?: number; // 1-based, global across rounds
  previousFailures?: string[]; // one entry per earlier rejected attempt
}

// Escalation: when a step keeps failing verification, the lead (호재/Opus) is
// asked to diagnose the root cause from the accumulated reviewer feedback + the
// current diff, and hand the builder concrete fix guidance for the next round.
export interface InterveneRequest {
  cwd: string;
  approvedPlan: string;
  stepDescription: string;
  index: number; // 1-based
  total: number;
  attempts: number; // how many build/verify attempts already failed
  failures: string[]; // each failing reviewer reason across the round
  diff: string; // the current (rejected) uncommitted diff
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
  plan(req: PlanRequest, reporter: PhaseReporter): Promise<PlanResult>;
  // Diagnose a repeatedly-failing step and return actionable fix guidance for
  // the builder (read-only; does not touch files).
  intervene(req: InterveneRequest, reporter: PhaseReporter): Promise<AgentResult>;
}

export interface Builder {
  build(req: BuildRequest, reporter: PhaseReporter): Promise<AgentResult>;
}

// 리서치 요청: 코드가 아니라 질문이다. cwd는 스크래치 작업 폴더일 뿐
// (수정 대상 저장소가 아님) — 리서처는 웹을 조사해 보고서 텍스트를 돌려준다.
export interface ResearchRequest {
  question: string;
  cwd: string;
  // 리서처의 승인된 방법론 교훈 (learn-store) — 프롬프트 주입용.
  learned?: string;
  // 후속 질문일 때: 지금까지의 대화 (이전 질문들과 보고서들, 시간순).
  // question은 이 이력에 이어지는 새 질문이다.
  history?: Array<{ role: "user" | "researcher"; text: string }>;
}

// 리서치 결과 = 보고서 + (선택) 리서처가 스스로 제안한 방법론 교훈. 교훈은
// 지식(낡는다)이 아니라 조사 방법(안 낡는다)만 — 제안함으로 가서 사용자 승인
// 후에야 프롬프트에 주입된다.
export interface ResearchResult extends AgentResult {
  lessons: Array<{ condition: string; lesson: string; evidence: string }>;
}

export interface Researcher {
  research(req: ResearchRequest, reporter: PhaseReporter): Promise<ResearchResult>;
}

// A named reviewer that inspects the built diff and returns pass/fail. The
// pipeline runs an injected array of these in parallel (a fan-out), so adding a
// second code reviewer or a test-runner is just another array entry in the
// composition root — the pipeline policy is unchanged (OCP). A "test" reviewer
// (running the project's tests) is homomorphic to a code reviewer, so it wears
// the same interface and joins the same fan-out.
export interface Reviewer {
  readonly name: string; // display label, e.g. "codex", "tests"
  readonly kind: Extract<StepKind, "review" | "test">;
  readonly engine: string; // claude | codex | system (for badge + pricing bucket)
  readonly model: string; // model id for pricing; "-" when there's no model
  review(req: VerifyRequest): Promise<VerifyResult>;
}
