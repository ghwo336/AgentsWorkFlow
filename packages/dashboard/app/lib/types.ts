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

// User-created group for research runs (e.g. "블록체인"). runCount is derived
// server-side; folders can exist empty.
export type ResearchFolder = {
  id: string;
  name: string;
  createdAt: string;
  runCount: number;
};

export type Run = {
  id: string;
  project: string;
  title: string;
  // 목록 응답에는 실리지 않는다 (계획서급 텍스트 — 상세에만).
  brief?: string;
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
  // research grouping; null/undefined = 미분류 (code runs never set this)
  folderId?: string | null;
  // 후속 작업이 이어받은 원작업 run id (요구사항 스레드 링크)
  parentRunId?: string | null;
  createdAt: string;
};

// 기획 문서의 한 버전 스냅샷 — Run.plan은 최신본만 들고 있고, 변천사는 이걸로.
export type PlanRevision = {
  id: string;
  version: number; // 1부터
  kind: string; // initial | revise | edit(승인하며 직접 수정)
  text: string; // 이 버전의 계획 전문
  feedback?: string | null; // 이 버전을 만든 사용자 수정 요청 (revise일 때만)
  createdAt: string;
};

// 요구사항 스레드의 한 노드 — 부모/후속 run의 링크 렌더용 최소 컬럼.
export type RunRef = {
  id: string;
  title: string;
  status: string;
  commit?: string | null;
  createdAt: string;
};

// 기획 피드의 한 run — 스레드(내 요청 → 계획 버전들 → 결과) 렌더용.
// revision 전문은 무거워서 피드에 실리지 않는다 (펼칠 때 getRun으로).
export type PlanFeedRevision = {
  id: string;
  version: number;
  kind: string; // initial | revise | edit
  feedback?: string | null;
  createdAt: string;
};
export type PlanFeedRun = {
  id: string;
  title: string;
  brief: string;
  status: string;
  commit?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  parentRunId?: string | null;
  planSteps?: string | null; // JSON string[] — 최신 계획의 분해 단계
  stepDevs?: string | null; // JSON (string|null)[] — 단계별 담당 개발자
  agents?: string | null;
  planRevisions: PlanFeedRevision[];
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
  // summary 원문 길이 — 라이브 뷰에선 summary가 미리보기 길이로 잘려 오므로,
  // 이 값이 summary.length보다 크면 전문은 getStep으로 따로 가져와야 한다.
  summaryLen?: number;
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
  // 기획 변천사 (버전 오름차순) — 옛 run은 빈 배열일 수 있다.
  planRevisions?: PlanRevision[];
  // 요구사항 스레드: 이 run이 이어받은 원작업 / 이 run에서 파생된 후속들.
  parentRun?: RunRef | null;
  childRuns?: RunRef[];
};

// One turn in the pre-plan requirements chat (client-held history).
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type StartRunInput = {
  title: string;
  brief: string;
  targetDir?: string;
  workspaceName?: string; // name a fresh workspace folder (used when targetDir is empty)
  agents?: string[]; // participating roster agent ids; omit for the full team
  parentRunId?: string; // 후속 작업일 때 원작업 run id (요구사항 스레드 링크)
};
