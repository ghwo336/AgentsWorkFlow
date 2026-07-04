import type { Builder, Planner, Researcher, Reviewer } from "../agents/types.js";
import type { GitOps } from "../git.js";
import type { RunStore } from "../run-store.js";

export interface PipelineConfig {
  maxVerifyRetries: number;
  planModel: string;
  buildModel: string;
  codexModel: string;
  researchModel: string;
  reviewPolicy: "all" | "any"; // commit when every / any reviewer passes
}

// Everything a pipeline mode needs, injected once at the composition root
// (runner.ts). Every side effect (LLM calls, git, persistence, reporting) is
// reached through these abstractions (DIP) — no mode module touches a concrete
// engine or the DB directly.
export interface PipelineDeps {
  planner: Planner;
  builder: Builder; // fallback when a builder id has no dedicated instance
  // Per-developer builders (person id → Builder with that person's harness):
  // 태경=프론트엔드, 민재=백엔드, 주희=iOS, 성민=Android, 연한=RN.
  buildersById?: Record<string, Builder>;
  reviewers: Reviewer[]; // fan-out: every reviewer inspects the same diff
  researcher: Researcher; // 리서치 전용 모드 (상현)
  git: GitOps;
  store: RunStore;
  config: PipelineConfig;
}
