import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const AUTH_REALM = "agent-loop dashboard";

// Brute-force throttle: 자격증명을 제시했지만 틀린 시도가 WINDOW 안에 MAX번
// 쌓인 IP는 창이 끝날 때까지 차단한다. 이 관문은 인터넷(Cloudflare Tunnel)에
// 노출된 유일한 방어선이라 무제한 대입을 허용하면 안 된다. 대시보드는 단일
// 프로세스라 인메모리 Map으로 충분하다 (재시작 시 리셋도 허용 범위).
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function isBlocked(ip: string): boolean {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() >= entry.resetAt) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip: string) {
  // 만료 항목 정리 — 맵이 무한히 자라지 않게 (스캐너가 IP를 바꿔가며 두드릴 때).
  if (failures.size > 1000) {
    const now = Date.now();
    for (const [k, v] of failures) if (now >= v.resetAt) failures.delete(k);
  }
  const entry = failures.get(ip);
  if (!entry || Date.now() >= entry.resetAt) {
    failures.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    entry.count++;
  }
}

// Constant-time string equality — `===` returns on the first differing char,
// leaking prefix length via response timing. Byte-wise XOR over the full
// length doesn't. (No node:crypto — middleware must stay runtime-agnostic.)
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
    },
  });
}

function tooManyAttempts() {
  return new NextResponse("Too many failed login attempts. Try again later.", {
    status: 429,
    headers: { "Retry-After": String(WINDOW_MS / 1000) },
  });
}

function authIsRequired() {
  return process.env.DASHBOARD_AUTH_REQUIRED === "true";
}

function decodeBasicAuth(header: string) {
  const [scheme, value] = header.split(" ");
  if (scheme !== "Basic" || !value) return null;

  try {
    const decoded = atob(value);
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  if (!authIsRequired()) return NextResponse.next();

  const expectedUsername = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return new NextResponse("Dashboard authentication is not configured", {
      status: 503,
    });
  }

  const ip = clientIp(request);
  if (isBlocked(ip)) return tooManyAttempts();

  const credentials = decodeBasicAuth(request.headers.get("authorization") ?? "");
  if (
    credentials &&
    safeEqual(credentials.username, expectedUsername) &&
    safeEqual(credentials.password, expectedPassword)
  ) {
    failures.delete(ip);
    return NextResponse.next();
  }

  // 자격증명을 제시했는데 틀린 경우만 실패로 센다 — 브라우저가 챌린지를 받기
  // 전에 보내는 무헤더 요청까지 세면 정상 사용자가 잠긴다.
  if (credentials) recordFailure(ip);
  return unauthorized();
}

export const config = {
  // Skip auth for Next internals and the site icons so the favicon always loads.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
