import { prisma } from "@agent-loop/shared/db";

export interface CreateRunInput {
  title: string;
  brief: string;
  project: string;
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
    return { status: r.status, brief: r.brief, plan: r.plan, targetDir: r.targetDir, steps };
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
}
