import { prisma } from "@agent-loop/shared/db";
import { parseAgents } from "@agent-loop/shared/roster";

// ALL writes to the Run table live in this module — the class methods below and
// this status update (delegated to by events.setStatus, which owns only the
// broadcast side). One writer = one place to reason about run-row transitions.
export function updateRunStatus(
  runId: string,
  status: string,
  extra: Partial<{ plan: string; commit: string; error: string; targetDir: string }> = {}
): Promise<unknown> {
  return prisma.run.update({ where: { id: runId }, data: { status, ...extra } });
}

// Parse a Run.planSteps JSON column into descriptions (shared by resume/stuck).
function parsePlanSteps(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map((s) => String(s)) : [];
  } catch {
    return []; /* malformed — fall back to none */
  }
}

export interface CreateRunInput {
  title: string;
  brief: string;
  project: string;
  // Participating roster seat keys; null/empty = 전원 (default team).
  agents?: string[] | null;
  // 사용자가 팀을 고르지 않음 — 호재가 계획하며 배치(추천 적용) 대상.
  autoTeam?: boolean;
}

// Persistence boundary for runs/projects. Keeps Prisma details out of the
// orchestration logic — the pipeline/runner talk to this, not the ORM (SRP/DIP).
export class RunStore {
  // Create a run, ensuring its project row exists so it shows in the launcher.
  async createRun(input: CreateRunInput): Promise<{ id: string }> {
    await prisma.project.upsert({
      where: { name: input.project },
      create: { name: input.project },
      update: {},
    });
    const run = await prisma.run.create({
      data: {
        title: input.title,
        brief: input.brief,
        project: input.project,
        status: "planning",
        agents: input.agents?.length ? JSON.stringify(input.agents) : null,
        autoTeam: input.autoTeam ?? false,
      },
    });
    return { id: run.id };
  }

  setTargetDir(runId: string, targetDir: string): Promise<unknown> {
    return prisma.run.update({ where: { id: runId }, data: { targetDir } });
  }

  // The project's remembered repo dir, used when a run omits targetDir.
  async getProjectDefaultDir(name: string): Promise<string | null> {
    const p = await prisma.project.findUnique({ where: { name } });
    return p?.defaultTargetDir?.trim() || null;
  }

  // Remember a project's working folder so later runs reuse it automatically.
  async setProjectDefaultDir(name: string, dir: string): Promise<void> {
    await prisma.project.upsert({
      where: { name },
      create: { name, defaultTargetDir: dir },
      update: { defaultTargetDir: dir },
    });
  }

  savePlan(runId: string, plan: string): Promise<unknown> {
    return prisma.run.update({ where: { id: runId }, data: { plan } });
  }

  // Apply 호재's recommended team (auto-team runs) — seat keys onto Run.agents.
  saveAgents(runId: string, seatKeys: string[]): Promise<unknown> {
    return prisma.run.update({
      where: { id: runId },
      data: { agents: JSON.stringify(seatKeys) },
    });
  }

  // Persist the decomposed plan steps so the build phase can resume from the DB
  // after an approval — even across an orchestrator restart. `devs` (같은 길이,
  // 항목 = builder person id 또는 null)는 단계별 담당 개발자 배정.
  saveSteps(runId: string, steps: string[], devs?: (string | null)[]): Promise<unknown> {
    return prisma.run.update({
      where: { id: runId },
      data: {
        planSteps: JSON.stringify(steps),
        stepDevs: devs?.some((d) => d) ? JSON.stringify(devs) : null,
      },
    });
  }

  async getTitle(runId: string): Promise<string | null> {
    const r = await prisma.run.findUnique({ where: { id: runId } });
    return r?.title ?? null;
  }

  // Everything needed to resume a run at the approval boundary from the DB.
  async getResumeState(runId: string): Promise<{
    status: string;
    brief: string;
    plan: string | null;
    targetDir: string | null;
    steps: string[];
    stepDevs: (string | null)[]; // 단계별 담당 개발자 person id (미배정 = null)
    agents: string[] | null; // participating seat keys; null = 전원
    autoTeam: boolean; // 호재가 팀을 배치하는 run (revise 시 재배치 허용)
  } | null> {
    const r = await prisma.run.findUnique({ where: { id: runId } });
    if (!r) return null;
    const steps = parsePlanSteps(r.planSteps);
    let stepDevs: (string | null)[] = [];
    if (r.stepDevs) {
      try {
        const arr = JSON.parse(r.stepDevs);
        if (Array.isArray(arr)) stepDevs = arr.map((d) => (d ? String(d) : null));
      } catch {
        /* malformed — no assignments */
      }
    }
    return {
      status: r.status,
      brief: r.brief,
      plan: r.plan,
      targetDir: r.targetDir,
      steps,
      stepDevs,
      agents: parseAgents(r.agents),
      autoTeam: r.autoTeam,
    };
  }

  // What 호재 needs to discuss a STUCK (needs_input) run with the user: the
  // approved plan, which step is stuck (= number of resolved commit-steps), the
  // park reason, and the latest rejection reasons. null = run not found.
  async getStuckContext(runId: string): Promise<{
    plan: string | null;
    steps: string[];
    stuckIdx: number;
    error: string | null;
    recentFailures: string[];
  } | null> {
    const r = await prisma.run.findUnique({ where: { id: runId } });
    if (!r) return null;
    const steps = parsePlanSteps(r.planSteps);
    const resolved = await prisma.step.count({
      where: { runId, kind: "commit", status: { in: ["passed", "skipped"] } },
    });
    const stuckIdx = Math.min(resolved, Math.max(0, steps.length - 1));
    const recentFails = await prisma.verdict.findMany({
      where: { runId, passed: false },
      orderBy: { ts: "desc" },
      take: 3,
    });
    return {
      plan: r.plan,
      steps,
      stuckIdx,
      error: r.error,
      recentFailures: recentFails.map((v) => v.reason),
    };
  }

  // The plan step's id (chain parent for the first build step) and the current
  // max orderIdx (so resumed steps sort after the existing ones).
  async getPlanStepId(runId: string): Promise<string | null> {
    const s = await prisma.step.findFirst({
      where: { runId, kind: "plan" },
      orderBy: { orderIdx: "desc" },
    });
    return s?.id ?? null;
  }

  async getMaxOrderIdx(runId: string): Promise<number> {
    const s = await prisma.step.findFirst({
      where: { runId },
      orderBy: { orderIdx: "desc" },
    });
    return s?.orderIdx ?? -1;
  }

  // Where to resume the build from: how many plan steps are already resolved
  // (each has a commit step marked passed OR skipped) and the id of the last such
  // step (the chain parent for the next one). Derived from the DB so it survives
  // an orchestrator restart and a user-intervention park/resume. `committedCount`
  // doubles as the 0-based index of the next (or stuck) step.
  async getResumePoint(runId: string): Promise<{
    committedCount: number;
    lastCommitStepId: string | null;
  }> {
    const resolved = await prisma.step.findMany({
      where: { runId, kind: "commit", status: { in: ["passed", "skipped"] } },
      orderBy: { orderIdx: "asc" },
    });
    return {
      committedCount: resolved.length,
      lastCommitStepId: resolved[resolved.length - 1]?.id ?? null,
    };
  }
}
