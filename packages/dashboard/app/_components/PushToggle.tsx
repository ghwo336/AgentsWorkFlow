"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

// 네비 오른쪽의 푸시 알림 토글(🔔/🔕). 켜면 이 브라우저를 오케스트레이터에
// 구독 등록해 승인 대기·입력 필요·완료·실패를 시스템 알림으로 받는다.
// 지원 안 되는 환경(iOS는 홈 화면 설치 전 PushManager가 없음)에선 아예
// 렌더하지 않는다 — 버튼이 보이면 눌러서 되는 상태라는 뜻.
type State = "unsupported" | "off" | "on" | "busy";

// VAPID 공개키(base64url) → PushManager.subscribe가 원하는 Uint8Array.
function decodeKey(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushToggle() {
  const [state, setState] = useState<State>("unsupported");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // SW는 푸시 지원과 무관하게 등록해 둔다 (등록 자체가 설치 UX에도 무해).
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (!("PushManager" in window) || !("Notification" in window)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => {});
  }, []);

  if (state === "unsupported") return null;

  async function toggle() {
    const prev = state;
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (prev === "on" && existing) {
        await api.pushUnsubscribe(existing.endpoint);
        await existing.unsubscribe();
        setState("off");
        return;
      }
      // 권한 요청은 사용자 제스처(이 클릭) 안에서만 허용된다 (특히 iOS).
      if ((await Notification.requestPermission()) !== "granted") {
        setState("off");
        return;
      }
      const { key } = await api.pushPublicKey();
      if (!key) throw new Error("서버에 VAPID 키가 설정되지 않았습니다");
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(key) as BufferSource,
        }));
      await api.pushSubscribe(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
      setState("on");
    } catch (err) {
      console.warn("푸시 설정 실패:", err);
      setState(prev);
    }
  }

  const on = state === "on";
  return (
    <button
      onClick={toggle}
      disabled={state === "busy"}
      title={on ? "푸시 알림 끄기" : "푸시 알림 켜기 (승인 대기·완료·실패)"}
      aria-label={on ? "푸시 알림 끄기" : "푸시 알림 켜기"}
      className="push-toggle"
      style={{ opacity: on ? 1 : 0.45 }}
    >
      {on ? "🔔" : "🔕"}
    </button>
  );
}
