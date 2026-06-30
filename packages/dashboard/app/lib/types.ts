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

export type Run = {
  id: string;
  project: string;
  title: string;
  brief: string;
  status: string;
  plan?: string | null;
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

export type RunDetail = Run & { events: RunEvent[]; verdicts: unknown[] };

export type StartRunInput = {
  title: string;
  brief: string;
  targetDir?: string;
};
