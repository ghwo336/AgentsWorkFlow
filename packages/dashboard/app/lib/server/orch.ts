// 이 모듈은 ORCH_TOKEN(공유 시크릿)을 다룬다 — 클라이언트 번들에 섞이면 토큰이
// 브라우저로 새므로, "use client" 파일이 import하는 순간 빌드가 실패하게 막는다.
import "server-only";

// The orchestrator owns the SQLite DB (host process). The dashboard reaches it
// over HTTP instead of opening the DB file itself — see http-data.ts on the
// orchestrator for why (bind-mount torn reads). Same base URL the approve/chat
// proxies use.
export const ORCH_URL =
  (process.env.ORCH_INTERNAL_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

// Shared secret the orchestrator requires on every route (ORCH_TOKEN, root
// .env). Server-side only — these helpers run in route handlers / server
// components, so the token never reaches the browser.
const ORCH_TOKEN = process.env.ORCH_TOKEN?.trim();

export function orchHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...(ORCH_TOKEN ? { Authorization: `Bearer ${ORCH_TOKEN}` } : {}),
    ...extra,
  };
}

// Server-side JSON fetch of an orchestrator data endpoint (for server components).
export async function orchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${ORCH_URL}${path}`, { cache: "no-store", headers: orchHeaders() });
  if (!res.ok) throw new Error(`orchestrator ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

// Forward a request to the orchestrator, preserving method/body/status — for the
// dashboard's /api/* route handlers that the client already calls.
export async function orchProxy(
  path: string,
  init?: { method?: string; body?: string }
): Promise<Response> {
  const upstream = await fetch(`${ORCH_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: orchHeaders({ "Content-Type": "application/json" }),
    body: init?.body,
    cache: "no-store",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    },
  });
}
