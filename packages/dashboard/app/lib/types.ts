// Client-side view models for the dashboard, shared across pages, hooks, and
// the API client. The server shapes (Prisma rows) are serialized to these.

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
  plan?: string | null;
  // JSON-encoded string[] of the decomposed plan-step descriptions (what each
  // 단계 N actually does), persisted when the plan is approved.
  planSteps?: string | null;
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
  attempt: number;
  status: string; // pending | running | passed | failed | skipped
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
  orderIdx: number;
};

export type RunDetail = Run & { events: RunEvent[]; verdicts: unknown[]; steps: Step[] };

// One turn in the pre-plan requirements chat (client-held history).
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type StartRunInput = {
  title: string;
  brief: string;
  targetDir?: string;
  workspaceName?: string; // name a fresh workspace folder (used when targetDir is empty)
};
