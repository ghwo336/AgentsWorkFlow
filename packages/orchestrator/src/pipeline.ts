import type { ApprovalGate } from "./approval-gate.js";
import type { Builder, Planner, Verifier } from "./agents/types.js";
import type { GitOps } from "./git.js";
import type { RunReporter } from "./reporter.js";
import type { RunStore } from "./run-store.js";

export interface PipelineConfig {
  maxVerifyRetries: number;
  planModel: string;
  buildModel: string;
  codexModel: string;
}

export interface PipelineDeps {
  planner: Planner;
  builder: Builder;
  verifier: Verifier;
  gate: ApprovalGate;
  git: GitOps;
  store: RunStore;
  config: PipelineConfig;
}

// The plan → approve → build/verify/commit state machine. It owns ONLY the
// orchestration policy; every side effect (LLM calls, git, persistence,
// reporting, approval) is reached through an injected abstraction (DIP), and
// each phase is its own method (SRP) so they can be read and changed in
// isolation.
export class RunPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  async run(
    runId: string,
    brief: string,
    targetDir: string,
    reporter: RunReporter
  ): Promise<void> {
    await this.deps.git.ensureRepo(targetDir);

    const planText = await this.plan(brief, targetDir, reporter);
    if (planText === null) return;

    const approvedPlan = await this.approve(runId, planText, reporter);
    if (approvedPlan === null) return;

    await this.buildVerifyCommit(runId, approvedPlan, brief, targetDir, reporter);
  }

  // ① PLAN (Opus) — returns the plan text, or null on failure (status set).
  private async plan(
    brief: string,
    targetDir: string,
    reporter: RunReporter
  ): Promise<string | null> {
    const { planner, config } = this.deps;
    await reporter.status("planning");
    await reporter.log("plan", `계획 수립 중 (${config.planModel})…`, { model: "opus" });

    const result = await planner.plan({ brief, cwd: targetDir }, reporter);
    if (result.isError || !result.text) {
      await reporter.status("failed", { error: "계획을 생성하지 못했습니다." });
      return null;
    }
    return result.text;
  }

  // ★ APPROVAL GATE (web) — returns the approved plan, or null if rejected.
  private async approve(
    runId: string,
    planText: string,
    reporter: RunReporter
  ): Promise<string | null> {
    const { gate, store } = this.deps;
    await reporter.status("awaiting_approval", { plan: planText });
    await reporter.log("approval", "계획 완성 — 대시보드에서 승인 대기 중입니다.");

    const decision = await gate.wait(runId);
    if (!decision.approved) {
      await reporter.log("approval", "사용자가 계획을 거절했습니다.", { level: "warn" });
      await reporter.status("rejected", { error: "사용자가 계획을 거절했습니다." });
      return null;
    }

    const approvedPlan = decision.editedPlan?.trim() || planText;
    if (decision.editedPlan) await store.savePlan(runId, approvedPlan);
    await reporter.log("approval", "계획 승인됨. 빌드를 시작합니다.");
    return approvedPlan;
  }

  // ②③④ BUILD (Sonnet) → VERIFY (codex) → COMMIT, retrying on rejection.
  private async buildVerifyCommit(
    runId: string,
    approvedPlan: string,
    brief: string,
    targetDir: string,
    reporter: RunReporter
  ): Promise<void> {
    const { builder, verifier, git, store, config } = this.deps;
    let feedback: string | undefined;

    for (let attempt = 1; attempt <= config.maxVerifyRetries; attempt++) {
      // ② BUILD (auto-approved)
      await reporter.status("building");
      await reporter.log(
        "build",
        `빌드 시도 ${attempt}/${config.maxVerifyRetries} (${config.buildModel})…`,
        { model: "sonnet" }
      );
      const buildResult = await builder.build(
        { approvedPlan, brief, cwd: targetDir, feedback },
        reporter
      );
      if (buildResult.isError) {
        await reporter.log("build", "빌드 에이전트에서 오류가 발생했습니다.", { level: "warn" });
      }

      if (!(await git.hasChanges(targetDir))) {
        await reporter.log("build", "변경된 파일이 없습니다.", { level: "warn" });
        feedback = "이전 시도에서 아무 변경도 만들지 않았습니다. 계획을 실제로 구현하세요.";
        continue;
      }

      // ③ VERIFY (codex, subscription)
      await reporter.status("verifying");
      await reporter.log("verify", "코덱스로 변경사항을 검증 중입니다…", { model: "codex" });
      const diff = await git.uncommittedDiff(targetDir);
      const result = await verifier.verify({ cwd: targetDir, plan: approvedPlan, diff });
      await reporter.verdict(attempt, result.passed, result.reason, diff, result.raw);
      if (result.usage) {
        await reporter.usage({
          engine: "codex",
          model: config.codexModel,
          phase: "verify",
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheRead: result.usage.cacheRead,
          cacheWrite: 0,
        });
      }
      await reporter.log(
        "verify",
        `코덱스 검증 ${result.passed ? "통과 ✅" : "거절 ❌"}: ${result.reason}`,
        { level: result.passed ? "info" : "warn", model: "codex" }
      );

      // ④ COMMIT (on PASS)
      if (result.passed) {
        const title = (await store.getTitle(runId)) ?? "agent-loop change";
        const message = `${title}\n\nVerified by codex (attempt ${attempt}).`;
        const sha = await git.commitAll(targetDir, message);
        await reporter.status("committed", { commit: sha });
        await reporter.log(
          "commit",
          `커밋 완료 ${sha.slice(0, 10)} ✅ (코덱스 검증 통과, ${attempt}번째 시도)`
        );
        return;
      }

      feedback = result.reason; // feed codex's rejection back into the next build
    }

    await reporter.log(
      "verify",
      `검증을 통과하지 못한 채 ${config.maxVerifyRetries}번의 시도를 모두 소진했습니다.`,
      { level: "error" }
    );
    await reporter.status("rejected", {
      error: `코덱스가 ${config.maxVerifyRetries}번의 시도를 모두 거절했습니다. 마지막 사유: ${feedback}`,
    });
  }
}
