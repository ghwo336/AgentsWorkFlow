import { prisma } from "@agent-loop/shared/db";
import { parseAgents } from "@agent-loop/shared/roster";

export interface CreateRunInput {
  title: string;
  brief: string;
  project: string;
  // Participating roster agent ids; null/empty = 전원 (default team).
  agents?: string[] | null;
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

  // Persist the decomposed plan steps so the build phase can resume from the DB
  // after an approval — even across an orchestrator restart.
  saveSteps(runId: string, steps: string[]): Promise<unknown> {
    return prisma.run.update({ where: { id: runId }, data: { planSteps: JSON.stringify(steps) } });
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
    agents: string[] | null; // participating roster ids; null = 전원
  } | null> {
    const r = await prisma.run.findUnique({ where: { id: runId } });
    if (!r) return null;
    let steps: string[] = [];
    if (r.planSteps) {
      try {
        const arr = JSON.parse(r.planSteps);
        if (Array.isArray(arr)) steps = arr.map((s) => String(s));
      } catch {
        /* malformed — fall back to none */
      }
    }
    return {
      status: r.status,
      brief: r.brief,
      plan: r.plan,
      targetDir: r.targetDir,
      steps,
      agents: parseAgents(r.agents),
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
