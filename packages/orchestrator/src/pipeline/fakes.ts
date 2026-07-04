import type { RunStatus, StepStatus, ChatTurn } from "@agent-loop/shared/types";
import type {
  AgentResult,
  Builder,
  Planner,
  PlanResult,
  Reviewer,
} from "../agents/types.js";
import type { CreateStepInput } from "../events.js";
import type { GitOps } from "../git.js";
import type { RunReporter, StepHandle } from "../reporter.js";
import type { RunStore } from "../run-store.js";
import type { PipelineConfig, PipelineDeps } from "./types.js";

// Fakes for the pipeline state machine (step-runner·intervention). Every side
// effect the pipeline reaches through PipelineDeps + the injected RunReporter is
// stubbed here so a mode function can be driven end-to-end in memory and its
// state transitions asserted — no DB, no git, no LLM. See *.test.ts alongside.

// ── Reporter ────────────────────────────────────────────────────────────────
export interface RecordedStep {
  id: string;
  input: CreateStepInput;
  status?: StepStatus; // set by finish()
  summary?: string;
}

export interface FakeReporter extends RunReporter {
  statuses: Array<{ status: RunStatus; error?: string; commit?: string }>;
  steps: RecordedStep[];
  chats: ChatTurn[];
  lastStatus(): RunStatus | undefined;
  hasStatus(s: RunStatus): boolean;
}

export function makeReporter(): FakeReporter {
  const statuses: FakeReporter["statuses"] = [];
  const steps: RecordedStep[] = [];
  const chats: ChatTurn[] = [];
  let seq = 0;
  return {
    statuses,
    steps,
    chats,
    lastStatus: () => statuses[statuses.length - 1]?.status,
    hasStatus: (s) => statuses.some((e) => e.status === s),
    async log() {},
    async usage() {},
    async status(status, extra) {
      statuses.push({ status, error: extra?.error, commit: extra?.commit });
    },
    async verdict() {},
    async chat(turn) {
      chats.push(turn);
    },
    async startStep(input): Promise<StepHandle> {
      const rec: RecordedStep = { id: `s${++seq}`, input };
      steps.push(rec);
      return {
        id: rec.id,
        async log() {},
        async usage() {},
        async verdict() {},
        async finish(status, summary) {
          rec.status = status;
          rec.summary = summary;
        },
      };
    },
  };
}

// ── Git ───────────────────────────────────────────────────────────────────────
// Stateful working tree: a build dirties it (markDirty), a commit/discard cleans
// it — mirroring real git so hasChanges() means "is there an uncommitted diff
// right now", not a fixed answer. `dirty:true` seeds a leftover diff (e.g. the
// rejected changes a run left behind when it parked at needs_input).
export class FakeGit implements GitOps {
  calls: string[] = [];
  commits: string[] = []; // commit messages, in order
  discarded = 0;
  private dirty: boolean;

  constructor(opts: { dirty?: boolean } = {}) {
    this.dirty = opts.dirty ?? false;
  }
  markDirty() {
    this.dirty = true;
  }
  async ensureRepo() {
    this.calls.push("ensureRepo");
  }
  async uncommittedDiff() {
    return "FAKE DIFF";
  }
  async hasChanges() {
    return this.dirty;
  }
  async commitAll(_cwd: string, message: string) {
    this.commits.push(message);
    this.dirty = false;
    return `sha${this.commits.length}`;
  }
  async discardChanges() {
    this.discarded++;
    this.dirty = false;
  }
  async headSha() {
    return "HEADSHA";
  }
}

// ── Agents ────────────────────────────────────────────────────────────────────
// A builder dirties the working tree when it runs (produces=true), so the loop's
// "변경 없음" guard sees a diff. produces:false models a builder that wrote
// nothing — the guard path.
export function makeBuilder(
  git?: FakeGit,
  opts: { produces?: boolean; result?: Partial<AgentResult> } = {}
): Builder {
  return {
    async build(): Promise<AgentResult> {
      if (git && opts.produces !== false) git.markDirty();
      return {
        text: opts.result?.text ?? "구현했습니다",
        isError: opts.result?.isError ?? false,
      };
    },
  };
}

export interface FakePlanner extends Planner {
  interveneCount: number;
}

// Planner whose intervene() just records that escalation happened and hands back
// canned guidance. plan() is never exercised by the build-loop tests.
export function makePlanner(): FakePlanner {
  const p: FakePlanner = {
    interveneCount: 0,
    async plan(): Promise<PlanResult> {
      throw new Error("makePlanner: plan() is not used in these tests");
    },
    async intervene(): Promise<AgentResult> {
      p.interveneCount++;
      return { text: "근본 원인을 다시 점검하고 X를 고치세요", isError: false };
    },
  };
  return p;
}

// Build-gate reviewer ("빌드" — always kept by reviewersFor's ensureBuildGate).
// verdict may be a constant or a function evaluated per review call, so a step
// can be made to fail a few attempts then pass.
export function makeReviewer(name: string, verdict: boolean | (() => boolean)): Reviewer {
  return {
    name,
    kind: "review",
    engine: "codex",
    model: "codex-model",
    async review() {
      const passed = typeof verdict === "function" ? verdict() : verdict;
      return { passed, reason: passed ? "통과" : "거절 사유", raw: "" };
    },
  };
}

// ── Store ─────────────────────────────────────────────────────────────────────
export interface StoreState {
  resume?: Awaited<ReturnType<RunStore["getResumeState"]>>;
  resumePoint?: Awaited<ReturnType<RunStore["getResumePoint"]>>;
  planStepId?: string | null;
  maxOrderIdx?: number;
  title?: string | null;
}

// Only the read methods the build/resume paths touch are implemented; the rest
// of RunStore is irrelevant here, so the object is cast to the class type.
export function makeStore(state: StoreState = {}): RunStore {
  const store = {
    async getResumeState() {
      return state.resume ?? null;
    },
    async getResumePoint() {
      return state.resumePoint ?? { committedCount: 0, lastCommitStepId: null };
    },
    async getPlanStepId() {
      return state.planStepId ?? "PLAN_STEP";
    },
    async getMaxOrderIdx() {
      return state.maxOrderIdx ?? 0;
    },
    async getTitle() {
      return state.title ?? "테스트 작업";
    },
  };
  return store as unknown as RunStore;
}

// Everything an in-memory resume state needs, with test-friendly defaults.
export function makeResumeState(
  over: Partial<NonNullable<Awaited<ReturnType<RunStore["getResumeState"]>>>> = {}
): NonNullable<Awaited<ReturnType<RunStore["getResumeState"]>>> {
  return {
    status: "needs_input",
    brief: "brief",
    plan: "PLAN",
    targetDir: "/ws",
    project: "proj",
    steps: ["단계1", "단계2", "단계3"],
    stepDevs: [],
    stepCommits: [],
    agents: ["plan:hojae", "build:taekyung", "verify:seongho"],
    autoTeam: false,
    ...over,
  };
}

// ── Config + deps assembly ────────────────────────────────────────────────────
export const baseConfig: PipelineConfig = {
  maxVerifyRetries: 2,
  planModel: "opus",
  buildModel: "sonnet",
  codexModel: "codex",
  researchModel: "grok",
  reflectModel: "sonnet",
  reviewPolicy: "all",
};

export function makeDeps(parts: Partial<PipelineDeps> = {}): PipelineDeps {
  const git = (parts.git as FakeGit) ?? new FakeGit();
  return {
    planner: parts.planner ?? makePlanner(),
    // Default builder dirties this run's git so the build gate sees a diff.
    builder: parts.builder ?? makeBuilder(git),
    buildersById: parts.buildersById,
    reviewers: parts.reviewers ?? [makeReviewer("빌드", true)],
    researchers: parts.researchers ?? [],
    reflector: parts.reflector,
    git,
    store: parts.store ?? makeStore(),
    config: parts.config ?? baseConfig,
  };
}

// Monotonic orderIdx source for executeSteps (the real one comes from the DB).
export function mkOrder(): () => number {
  let n = 0;
  return () => n++;
}
