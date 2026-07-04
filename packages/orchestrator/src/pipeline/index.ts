import type { RunRoster } from "@agent-loop/shared/roster";
import type { InterventionDecision } from "@agent-loop/shared/types";
import type { RunReporter } from "../reporter.js";
import { directBuild } from "./direct-build.js";
import { build, plan } from "./full.js";
import { resumeFromInput } from "./intervention.js";
import { planOnly } from "./plan-only.js";
import { research, researchFollowUp } from "./research.js";
import { verifyOnly } from "./verify-only.js";
import type { PipelineDeps } from "./types.js";

export type { PipelineConfig, PipelineDeps } from "./types.js";

// Facade over the pipeline MODES, each its own module with a single reason to
// change (SRP):
//   full.ts          계획 → ★승인 → 빌드 진입 (승인 게이트 + 재개 지점 계산)
//   step-runner.ts   단계별 구현/검증/커밋 루프 + 호재 에스컬레이션
//   intervention.ts  needs_input 재개 (guide/commit/skip/abort)
//   build-state.ts   재시작-안전 빌드 상태 로드 (DB → 계획/단계/로스터)
//   direct-build.ts  기획 생략 — brief를 단일 단계로 바로 구현
//   plan-only.ts     기획만 — 계획서 작성 후 종료
//   verify-only.ts   검증만 — 프로젝트 현재 상태 감사
//   research.ts      리서치 — 웹 조사 후 보고서 작성 (상현 단독)
// 공유 협력자(리뷰 팬아웃/계획 스텝/로스터 유틸)는 shared.ts, 팀 스태핑 정책은
// team-staffing.ts. 이 클래스는 deps 바인딩과 위임만 한다.
export class RunPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  plan(
    runId: string,
    brief: string,
    targetDir: string,
    reporter: RunReporter,
    opts?: { previousPlan?: string; feedback?: string; suggestTeam?: boolean; builderIds?: string[] }
  ): Promise<void> {
    return plan(this.deps, runId, brief, targetDir, reporter, opts);
  }

  build(runId: string, reporter: RunReporter): Promise<void> {
    return build(this.deps, runId, reporter);
  }

  resumeFromInput(runId: string, reporter: RunReporter, decision: InterventionDecision): Promise<void> {
    return resumeFromInput(this.deps, runId, reporter, decision);
  }

  directBuild(runId: string, brief: string, targetDir: string, reporter: RunReporter): Promise<void> {
    return directBuild(this.deps, runId, brief, targetDir, reporter);
  }

  planOnly(runId: string, brief: string, targetDir: string, reporter: RunReporter): Promise<void> {
    return planOnly(this.deps, runId, brief, targetDir, reporter);
  }

  research(
    runId: string,
    question: string,
    targetDir: string,
    reporter: RunReporter,
    roster: RunRoster
  ): Promise<void> {
    return research(this.deps, runId, question, targetDir, reporter, roster);
  }

  researchFollowUp(
    runId: string,
    question: string,
    targetDir: string,
    reporter: RunReporter,
    roster: RunRoster
  ): Promise<void> {
    return researchFollowUp(this.deps, runId, question, targetDir, reporter, roster);
  }

  verifyOnly(
    runId: string,
    brief: string,
    targetDir: string,
    reporter: RunReporter,
    roster: RunRoster
  ): Promise<void> {
    return verifyOnly(this.deps, runId, brief, targetDir, reporter, roster);
  }
}
