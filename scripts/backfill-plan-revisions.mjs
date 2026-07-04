// One-time backfill: PlanRevision 도입(2026-07-04) 이전 run들의 기획 이력 복원.
//
// Run.plan은 revise마다 덮어써져 과거 버전이 없지만, 계획 패스마다 남은
// Step(kind=plan, passed)의 summary에 그 버전의 계획 전문이, Event(approval,
// "수정 요청: …")에 사용자 피드백이 흩어져 있다 — 그걸 PlanRevision 행으로
// 모은다. 마지막 버전의 텍스트만은 Run.plan(승인 시 직접 편집까지 반영된
// 정본)을 쓴다. 이미 revision이 있는 run은 건너뛰므로 재실행해도 안전하다.
//
// 실행 (repo 루트에서):
//   DATABASE_URL="file:/Users/Shared/srv/agent-loop/prisma/prisma/dev.db" \
//     node scripts/backfill-plan-revisions.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const FEEDBACK_PREFIX = "수정 요청: ";

const runs = await prisma.run.findMany({
  where: { plan: { not: null } },
  select: { id: true, title: true, plan: true, planRevisions: { select: { id: true }, take: 1 } },
});

let filled = 0;
let skipped = 0;
for (const run of runs) {
  if (run.planRevisions.length) {
    skipped++;
    continue;
  }
  // kind=plan에는 호재의 개입 진단("단계 N/M · 호재 개입")도 섞여 있다 —
  // 계획 문서를 만든 패스는 planOnce의 두 라벨뿐이다.
  const steps = await prisma.step.findMany({
    where: { runId: run.id, kind: "plan", status: "passed", label: { in: ["계획", "계획 수정"] } },
    orderBy: [{ orderIdx: "asc" }, { startedAt: "asc" }],
    select: { summary: true, startedAt: true, endedAt: true },
  });
  if (steps.length === 0) {
    skipped++; // direct-build 등 계획 단계가 없던 run — 복원할 이력이 없다
    continue;
  }
  const feedbacks = (
    await prisma.event.findMany({
      where: { runId: run.id, phase: "approval", message: { startsWith: FEEDBACK_PREFIX } },
      orderBy: { ts: "asc" },
      select: { message: true },
    })
  ).map((e) => e.message.slice(FEEDBACK_PREFIX.length));

  const data = steps.map((s, i) => ({
    runId: run.id,
    version: i + 1,
    kind: i === 0 ? "initial" : "revise",
    text: (i === steps.length - 1 ? run.plan : s.summary) || run.plan || "",
    feedback: i > 0 ? (feedbacks[i - 1] ?? null) : null,
    createdAt: s.endedAt ?? s.startedAt,
  }));
  await prisma.planRevision.createMany({ data });
  filled++;
  console.log(`✓ ${run.id} "${run.title}" — ${data.length}개 버전 복원`);
}

console.log(`완료: ${filled}개 run 복원, ${skipped}개 건너뜀 (이미 있음/이력 없음)`);
await prisma.$disconnect();
