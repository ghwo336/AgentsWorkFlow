import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pushEnabled, pushPublicKey, removeSubscription, saveSubscription } from "./push.js";

// 웹 푸시 구독 API — 대시보드 PushToggle이 프록시(/api/orch/push/*)를 거쳐
// 부른다. 발송 자체는 push.ts(notifyRunStatus)가 상태 전환에서 알아서 한다.
const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

const UnsubscribeSchema = z.object({ endpoint: z.string().min(1) });

export function registerPushRoutes(app: FastifyInstance): void {
  // key=null → 클라이언트는 "서버에 푸시가 꺼져 있다"로 안내한다.
  app.get("/push/public-key", async () => ({ key: pushPublicKey() }));

  app.post("/push/subscribe", async (req, reply) => {
    if (!pushEnabled()) {
      return reply.code(503).send({ error: "VAPID 키가 설정되지 않아 푸시가 꺼져 있습니다" });
    }
    const parsed = SubscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await saveSubscription(parsed.data);
    return { ok: true };
  });

  app.post("/push/unsubscribe", async (req, reply) => {
    const parsed = UnsubscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await removeSubscription(parsed.data.endpoint);
    return { ok: true };
  });
}
