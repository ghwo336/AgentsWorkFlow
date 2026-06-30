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

  savePlan(runId: string, plan: string): Promise<unknown> {
    return prisma.run.update({ where: { id: runId }, data: { plan } });
  }

  async getTitle(runId: string): Promise<string | null> {
    const r = await prisma.run.findUnique({ where: { id: runId } });
    return r?.title ?? null;
  }
}
