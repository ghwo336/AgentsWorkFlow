import webpush from "web-push";
import { config } from "./config.js";
import { prisma } from "./db.js";

// 웹 푸시 발송 — 대시보드(PWA)가 등록한 브라우저 구독에게 run의 굵직한 상태
// 전환을 알린다. 유일한 훅 지점은 events.setStatus (상태 전환의 단일 창구).
// VAPID 키(루트 .env)가 없으면 전체가 no-op — 라우트는 503/null로 답한다.

const enabled = !!(config.vapidPublicKey && config.vapidPrivateKey);
if (enabled) {
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey!, config.vapidPrivateKey!);
}

export const pushEnabled = (): boolean => enabled;
export const pushPublicKey = (): string | null => (enabled ? config.vapidPublicKey! : null);

export async function saveSubscription(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

// 알림을 쏠 상태 전환만 — 사용자 액션이 필요하거나(승인/입력) 작업이 끝난
// 순간(커밋/보고/실패)이다. building/verifying 같은 중간 상태는 소음.
const STATUS_NOTIFICATIONS: Record<string, { title: string; body: (t: string) => string }> = {
  awaiting_approval: { title: "📋 계획 승인 대기", body: (t) => `${t} — 호재의 계획이 나왔어요` },
  needs_input: { title: "🙋 입력 필요", body: (t) => `${t} — 팀이 막혀서 리더의 결정을 기다려요` },
  committed: { title: "🎉 작업 완료", body: (t) => `${t} — 전 단계 검증 통과, 커밋됐어요` },
  reported: { title: "📄 리서치 완료", body: (t) => `${t} — 보고서가 나왔어요` },
  failed: { title: "❌ 작업 실패", body: (t) => t },
};

// Fire-and-forget: 발송 실패가 상태 전환(setStatus)을 굴려 넘어뜨리면 안 된다.
// 404/410(구독 만료·해지)은 그 자리에서 구독을 지워 다음 발송을 깨끗하게.
export function notifyRunStatus(runId: string, status: string): void {
  if (!enabled) return;
  const note = STATUS_NOTIFICATIONS[status];
  if (!note) return;
  void (async () => {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { title: true } });
    const payload = JSON.stringify({
      title: note.title,
      body: note.body(run?.title ?? "작업"),
      url: `/runs/${runId}`,
      tag: runId, // 같은 run의 연속 알림은 마지막 것으로 대체
    });
    const subs = await prisma.pushSubscription.findMany();
    await Promise.allSettled(
      subs.map((s) =>
        webpush
          .sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 60 * 60 }
          )
          .catch(async (err: { statusCode?: number }) => {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              await removeSubscription(s.endpoint).catch(() => {});
            } else {
              console.warn(`[push] 발송 실패 (${err?.statusCode ?? "?"}): ${s.endpoint.slice(0, 60)}…`);
            }
          })
      )
    );
  })().catch((err) => console.warn("[push] notifyRunStatus 실패:", err));
}
