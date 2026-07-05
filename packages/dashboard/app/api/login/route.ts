import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_S } from "../../lib/session";

export const dynamic = "force-dynamic";

// 로그인 폼 제출 → 세션 쿠키 발급. proxy.ts(미들웨어)가 이 경로를 인증 예외로
// 두므로, 미들웨어의 Basic Auth 잠금과는 별도로 여기서도 IP당 대입 시도를
// 제한한다 (같은 정책: 15분에 10회).
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(req: Request): Promise<Response> {
  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!username || !password) {
    return NextResponse.json({ error: "로그인이 설정되지 않았습니다" }, { status: 503 });
  }

  const ip = clientIp(req);
  const entry = failures.get(ip);
  if (entry && Date.now() < entry.resetAt && entry.count >= MAX_FAILURES) {
    return NextResponse.json(
      { error: "실패가 너무 많습니다. 15분 뒤에 다시 시도하세요." },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { username?: string; password?: string }
    | null;
  if (
    typeof body?.username !== "string" ||
    typeof body?.password !== "string" ||
    !safeEq(body.username, username) ||
    !safeEq(body.password, password)
  ) {
    if (!entry || Date.now() >= entry.resetAt) {
      failures.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
    } else {
      entry.count++;
    }
    return NextResponse.json({ error: "아이디 또는 비밀번호가 틀렸습니다" }, { status: 401 });
  }

  failures.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    // 로컬 dev(http://127.0.0.1)는 Secure 쿠키가 저장되지 않으므로 prod에서만.
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_S,
    path: "/",
  });
  return res;
}
