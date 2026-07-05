import { prisma } from "./db.js";
import { parseAgents } from "@agent-loop/shared/roster";
import { ERROR_STATUSES } from "@agent-loop/shared/types";

// ALL writes to the Run table live in this module — the class methods below and
// this status update (delegated to by events.setStatus, which owns only the
// broadcast side). One writer = one place to reason about run-row transitions.
export function updateRunStatus(
  runId: string,
  status: string,
  extra: Partial<{ plan: string; commit: string; error: string; targetDir: string }> = {}
): Promise<unknown> {
  // 정상 상태로의 전환은 이전 실패 메시지를 함께 지운다 — 재시작 sweep이 남긴
  // "중단됨"이 재개 후 committed까지 따라붙던 문제. 실패류 전환은 호출부가
  // 실어 보내는 error를 그대로 쓴다.
  const clearStale = ERROR_STATUSES.has(status) ? {} : { error: null };
  return prisma.run.update({ where: { id: runId }, data: { status, ...clearStale, ...extra } });
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
  // 후속 작업이 이어받은 직전 run — 요구사항 스레드 링크 (없으면 독립 작업).
  parentRunId?: string;
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
    // 부모 링크는 실재하는 run만 — 없는 id가 오면 스레드가 끊긴 채로 두느니
    // 링크 없이 만든다 (조용히 무시).
    const parentRunId = input.parentRunId
      ? ((await prisma.run.findUnique({ where: { id: input.parentRunId }, select: { id: true } }))?.id ?? null)
      : null;
    const run = await prisma.run.create({
      data: {
        title: input.title,
        brief: input.brief,
        project: input.project,
        status: "planning",
        agents: input.agents?.length ? JSON.stringify(input.agents) : null,
        autoTeam: input.autoTeam ?? false,
        parentRunId,
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

  // 기획 스냅샷 한 줄 추가 — Run.plan(최신본)은 덮어써지므로 버전 이력은
  // 여기 쌓인다. 한 run에 planner는 하나뿐이라 버전 경쟁은 없다.
  async savePlanRevision(
    runId: string,
    text: string,
    opts: { kind: "initial" | "revise" | "edit"; feedback?: string }
  ): Promise<void> {
    const last = await prisma.planRevision.findFirst({
      where: { runId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    await prisma.planRevision.create({
      data: {
        runId,
        version: (last?.version ?? 0) + 1,
        kind: opts.kind,
        text,
        feedback: opts.feedback ?? null,
      },
    });
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
  // 항목 = builder person id 또는 null)는 단계별 담당 개발자 배정, `commits`
  // (같은 길이)는 단계별 conventional commit 제목.
  saveSteps(
    runId: string,
    steps: string[],
    devs?: (string | null)[],
    commits?: (string | null)[]
  ): Promise<unknown> {
    return prisma.run.update({
      where: { id: runId },
      data: {
        planSteps: JSON.stringify(steps),
        stepDevs: devs?.some((d) => d) ? JSON.stringify(devs) : null,
        stepCommits: commits?.some((c) => c) ? JSON.stringify(commits) : null,
      },
    });
  }

  async getTitle(runId: string): Promise<string | null> {
    const r = await prisma.run.findUnique({ where: { id: runId } });
    return r?.title ?? null;
  }

  // 이 run이 이어받은 직전(부모) 작업의 맥락 — 후속 기획 프롬프트에 주입된다.
  // 부모가 없거나(독립 작업) 지워졌으면 null.
  async getLineageFor(runId: string): Promise<{
    title: string;
    plan: string | null;
    commit: string | null;
    error: string | null;
    status: string;
  } | null> {
    const r = await prisma.run.findUnique({ where: { id: runId }, select: { parentRunId: true } });
    if (!r?.parentRunId) return null;
    const parent = await prisma.run.findUnique({
      where: { id: r.parentRunId },
      select: { title: true, plan: true, commit: true, error: true, status: true },
    });
    if (!parent) return null;
    return parent;
  }

  // 이 run이 속한 프로젝트 이름 — 팀 학습 노트(learn-store)의 스코프 키.
  async getProject(runId: string): Promise<string | null> {
    const r = await prisma.run.findUnique({ where: { id: runId } });
    return r?.project ?? null;
  }

  // 리서치 run의 대화 스레드 — 사용자 질문(user)과 리서처들의 보고서(research)만,
  // 시간순. 후속 질문 시 리서처에게 넘길 맥락이다 (최초 질문은 Run.brief라
  // 여기 없음 — 호출부가 앞에 붙인다). agent = 보고서 화자(sanghyun/yerim).
  async getResearchThread(
    runId: string
  ): Promise<Array<{ role: "user" | "researcher"; agent: string | null; text: string }>> {
    const rows = await prisma.chatMsg.findMany({
      where: { runId, role: { in: ["user", "research"] } },
      orderBy: { ts: "asc" },
    });
    return rows.map((r) => ({
      role: r.role === "user" ? ("user" as const) : ("researcher" as const),
      agent: r.agent,
      text: r.text,
    }));
  }

  // Everything needed to resume a run at the approval boundary from the DB.
  async getResumeState(runId: string): Promise<{
    status: string;
    brief: string;
    plan: string | null;
    targetDir: string | null;
    project: string; // 학습 노트 스코프 키
    steps: string[];
    stepDevs: (string | null)[]; // 단계별 담당 개발자 person id (미배정 = null)
    stepCommits: (string | null)[]; // 단계별 커밋 제목 (미지정 = null)
    agents: string[] | null; // participating seat keys; null = 전원
    autoTeam: boolean; // 호재가 팀을 배치하는 run (revise 시 재배치 허용)
  } | null> {
    const r = await prisma.run.findUnique({ where: { id: runId } });
    if (!r) return null;
    const steps = parsePlanSteps(r.planSteps);
    // stepDevs/stepCommits: steps와 같은 길이의 nullable 배열 (깨지면 빈 배열).
    const parseAligned = (json: string | null): (string | null)[] => {
      if (!json) return [];
      try {
        const arr = JSON.parse(json);
        return Array.isArray(arr) ? arr.map((d) => (d ? String(d) : null)) : [];
      } catch {
        return [];
      }
    };
    return {
      status: r.status,
      brief: r.brief,
      plan: r.plan,
      targetDir: r.targetDir,
      project: r.project,
      steps,
      stepDevs: parseAligned(r.stepDevs),
      stepCommits: parseAligned(r.stepCommits),
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
