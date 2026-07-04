import { prisma } from "./db.js";

// Nothing in-flight survives a restart: builds/reviews live inside this process,
// so any Step still 'running' (or run still planning/building/verifying) at BOOT
// is an orphan from the previous process. Without this sweep those rows stay
// 'running' forever — the dashboard keeps the teammate on fire (민재 열일 중 🔥)
// and progress views show a step that will never finish. Parked states
// (awaiting_approval, needs_input) are restart-safe by design and left alone.
const INTERRUPTED = "오케스트레이터 재시작으로 중단됨";

export async function sweepOrphans(): Promise<void> {
  const steps = await prisma.step.updateMany({
    where: { status: "running" },
    data: { status: "failed", summary: INTERRUPTED, endedAt: new Date() },
  });
  const runs = await prisma.run.updateMany({
    where: { status: { in: ["planning", "building", "verifying", "researching"] } },
    data: {
      status: "failed",
      error: `${INTERRUPTED} — 계획이 승인된 작업은 '다시 진행'으로 멈춘 단계부터 이어집니다.`,
    },
  });
  if (steps.count || runs.count) {
    console.log(`startup sweep: 중단 처리 — steps=${steps.count}, runs=${runs.count}`);
  }
}
