// Client-side view models for the dashboard, shared across pages, hooks, and
// the API client. The server shapes (Prisma rows) are serialized to these.

// Cross-package vocabulary lives in @agent-loop/shared — re-exported here so
// client code keeps a single import surface for its types.
export type { InterventionDecision, ChatRole, ChatKind } from "@agent-loop/shared/types";

export type ProjectSummary = {
  name: string;
  runCount: number;
  lastStatus: string | null;
  lastTitle: string | null;
  lastAt: string | null;
  costUsd: number;
};

export type Project = {
  name: string;
  defaultTargetDir: string | null;
  createdAt: string;
};

export type Run = {
  id: string;
  project: string;
  title: string;
  brief: string;
  status: string;
  // JSON-encoded string[] of participating roster agent ids; null = 전원.
  agents?: string | null;
  plan?: string | null;
  // JSON-encoded string[] of the decomposed plan-step descriptions (what each
  // 단계 N actually does), persisted when the plan is approved.
  planSteps?: string | null;
  // JSON-encoded (string|null)[] aligned with planSteps: 단계별 담당 개발자
  // person id (계획에서 배정, 미배정 = null).
  stepDevs?: string | null;
  commit?: string | null;
  error?: string | null;
  targetDir?: string | null;
  createdAt: string;
};

export type RunEvent = {
  id: string;
  phase: string;
  level: string;
  model?: string | null;
  message: string;
  ts: string;
};

// One agent's work span within a run. Same data drives every visualization:
// the list badges, the kanban columns (status), the node graph (parentId edge),
// and the timeline/gantt bars (startedAt→endedAt).
export type Step = {
  id: string;
  runId: string;
  parentId: string | null;
  kind: string; // plan | build | verify | review | test | commit
  label: string;
  engine: string | null;
  model: string | null;
  agent?: string | null; // roster agent id who owns this span (null on legacy rows)
  attempt: number;
  status: string; // pending | running | passed | failed | skipped
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
  orderIdx: number;
};

// One turn in a run's agent team chat (build/verify/escalate/guide/commit).
// role+attempt resolve to the same pixel character the step avatars use.
export type ChatMsg = {
  id: string;
  role: string; // plan | build | verify | system | user
  attempt: number;
  kind: string; // build | verify | escalate | guide | commit | note
  engine?: string | null; // reviewer engine for verify turns (codex | claude | system)
  agent?: string | null; // roster agent id of the speaker (null on legacy rows)
  toRole: string | null;
  stepLabel: string | null;
  passed: boolean | null;
  text: string;
  ts: string;
};

export type RunDetail = Run & {
  events: RunEvent[];
  verdicts: unknown[];
  steps: Step[];
  chatMsgs: ChatMsg[];
  // 전체 행 수 — events/chatMsgs가 최신 N개로 잘려 왔을 때 "더보기" 잔여 계산용.
  eventsTotal?: number;
  chatTotal?: number;
};

// One turn in the pre-plan requirements chat (client-held history).
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type StartRunInput = {
  title: string;
  brief: string;
  targetDir?: string;
  workspaceName?: string; // name a fresh workspace folder (used when targetDir is empty)
  agents?: string[]; // participating roster agent ids; omit for the full team
};
