import { addProposals, appendProjectLessons } from "../agents/learn-store.js";
import type { RunReporter } from "../reporter.js";
import type { PipelineDeps } from "./types.js";

// Run 종료 후 회고 스텝 — 검증 팬아웃의 거절 사유(단계별 실패 이력)에서 다음
// run에도 유효한 교훈을 추출해 learn-store에 쌓는다. 프로젝트 사실은 자동
// 저장, 에이전트 행동 교훈은 제안함(사용자 승인 게이트)으로.
//
// 학습은 부가 기능이다: 어떤 실패도 run의 결과를 바꾸면 안 되므로 전체를
// try/catch로 감싸고, reflector 미주입(테스트)이나 학습할 이력 없음이면 조용히
// 건너뛴다.
export async function reflectAndLearn(
  deps: PipelineDeps,
  args: {
    runId: string;
    project: string;
    brief: string;
    plan: string;
    targetDir: string;
    builderIds: string[];
    steps: Array<{ description: string; failures: string[] }>;
    reporter: RunReporter;
    order: () => number;
  }
): Promise<void> {
  const { reflector, config } = deps;
  if (!reflector || args.steps.length === 0) return;
  const { reporter } = args;
  try {
    // 회고는 팀 리더(호재)의 일 — plan-kind 스텝으로 타임라인에 인라인 표시.
    const step = await reporter.startStep({
      kind: "plan",
      label: "회고",
      engine: "claude",
      model: config.reflectModel,
      agent: "hojae",
      orderIdx: args.order(),
    });
    await step.log("plan", `호재가 이번 run을 회고합니다 — 팀 학습 노트에 남길 교훈을 추립니다…`, {
      model: "opus",
    });
    const { outcome, usage } = await reflector.reflect({
      project: args.project,
      brief: args.brief,
      plan: args.plan,
      cwd: args.targetDir,
      builderIds: args.builderIds,
      steps: args.steps,
    });
    if (usage) {
      await step.usage({
        engine: "claude",
        model: config.reflectModel,
        phase: "plan",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheRead: usage.cacheRead,
        cacheWrite: 0,
      });
    }
    const saved = appendProjectLessons(args.project, outcome.projectFacts, { runId: args.runId });
    const proposed = addProposals(outcome.proposals, { project: args.project, runId: args.runId });
    const summary =
      saved === 0 && proposed === 0
        ? "이번 run에서는 남길 교훈이 없었습니다 — 학습 노트 변경 없음."
        : [
            saved > 0 ? `프로젝트 학습 노트에 ${saved}건 저장` : "",
            proposed > 0 ? `팀원 교훈 ${proposed}건을 제안함에 등록 (팀 소개 탭에서 승인/거절)` : "",
          ]
            .filter(Boolean)
            .join(" · ");
    await step.finish("passed", summary);
    if (saved > 0 || proposed > 0) await reporter.log("plan", `회고 완료 🧠 ${summary}`);
  } catch (err) {
    // 학습 실패는 run 실패가 아니다 — 로그만 남기고 삼킨다.
    const msg = err instanceof Error ? err.message : String(err);
    await reporter.log("plan", `회고를 건너뜁니다 (학습 실패: ${msg})`, { level: "warn" }).catch(() => {});
  }
}
