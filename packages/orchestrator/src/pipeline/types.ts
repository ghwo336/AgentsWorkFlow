import type { Reflector } from "../agents/reflector.js";
import type { Builder, Planner, Researcher, Reviewer } from "../agents/types.js";
import type { GitOps } from "../git.js";
import type { RunStore } from "../run-store.js";

// 리서치 팬아웃의 한 자리 — 어느 팀원이(agentId/name) 어떤 엔진으로 조사하는지.
// model은 스텝 표시/과금 버킷용 라벨 (grok은 구독이라 과금 없음 — 표시용).
export interface ResearcherSeat {
  agentId: string; // sanghyun | yerim
  name: string; // 상현 | 예림
  engine: string; // grok | claude
  model: string;
  researcher: Researcher;
}

export interface PipelineConfig {
  maxVerifyRetries: number;
  planModel: string;
  buildModel: string;
  codexModel: string;
  researchModel: string;
  reflectModel: string; // run 종료 후 회고(교훈 추출)용 — 저부담 작업이라 기본 Sonnet
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
  // 리서치 팬아웃 — 선택된 리서처 전원이 같은 질문을 동시에 조사한다.
  // 상현(Grok, X 전담)·예림(Claude, 웹 전담). 리뷰어 배열과 같은 원리(OCP).
  researchers: ResearcherSeat[];
  // Run 종료 후 회고 — 검증 실패 이력에서 교훈을 뽑아 learn-store에 쌓는다.
  // 부가 기능이라 optional: 없으면(테스트 등) 학습 없이 동작이 동일하다.
  reflector?: Reflector;
  git: GitOps;
  store: RunStore;
  config: PipelineConfig;
}
