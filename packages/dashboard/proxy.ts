import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./app/lib/session";

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

// 인증 실패: 화면 이동(GET+HTML)은 로그인 페이지로, API 호출은 401 JSON.
// WWW-Authenticate 챌린지는 더 이상 안 보낸다 — 브라우저 네이티브 프롬프트가
// PWA(standalone)에서 매 실행마다 떠서 쿠키 세션(/login)으로 대체했다.
// Authorization 헤더를 직접 보내는 클라이언트(curl -u)는 여전히 통과한다.
function unauthorized(request: NextRequest) {
  const wantsHtml =
    request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  if (wantsHtml) {
    const login = new URL("/login", request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== "/") login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }
  return new NextResponse("Authentication required", { status: 401 });
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

export async function proxy(request: NextRequest) {
  if (!authIsRequired()) return NextResponse.next();

  const expectedUsername = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return new NextResponse("Dashboard authentication is not configured", {
      status: 503,
    });
  }

  // 세션 쿠키(/login에서 발급, 키는 비밀번호에서 파생)가 1순위 경로.
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session && (await verifySessionToken(session, expectedPassword))) {
    return NextResponse.next();
  }

  // 이미 로그인 화면으로 가는 중이면 통과 — 리다이렉트 루프 방지.
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  const ip = clientIp(request);
  if (isBlocked(ip)) return tooManyAttempts();

  // Basic Auth 폴백 — curl 등 헤더를 직접 보내는 클라이언트용.
  const credentials = decodeBasicAuth(request.headers.get("authorization") ?? "");
  if (
    credentials &&
    safeEqual(credentials.username, expectedUsername) &&
    safeEqual(credentials.password, expectedPassword)
  ) {
    failures.delete(ip);
    return NextResponse.next();
  }

  // 자격증명을 제시했는데 틀린 경우만 실패로 센다 — 무헤더 첫 방문(로그인 전
  // 리다이렉트 대상)까지 세면 정상 사용자가 잠긴다.
  if (credentials) recordFailure(ip);
  return unauthorized(request);
}

export const config = {
  // Skip auth for Next internals, site icons, and the PWA shell files —
  // 매니페스트/서비스워커/앱 아이콘은 브라우저가 쿠키 없이 가져갈 수 있어야
  // 홈 화면 설치가 동작한다 (민감 정보 없음).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|sw.js|manifest.webmanifest).*)",
  ],
};
