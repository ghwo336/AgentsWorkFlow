// 로그인 세션 토큰 — PWA(standalone)에서 Basic Auth 프롬프트가 매번 뜨는 문제를
// 없애려고 쿠키 세션으로 전환하면서 생긴 모듈. 발급은 /api/login(Node 런타임),
// 검증은 proxy.ts(미들웨어 런타임) — 두 곳에서 다 돌아야 하므로 node:crypto가
// 아닌 Web Crypto(crypto.subtle)만 쓴다.
//
// 서명 키는 DASHBOARD_PASSWORD에서 파생한다: 별도 SESSION_SECRET을 늘리지 않고,
// 비밀번호를 돌리면 기존 세션이 전부 무효화되는(원하는) 성질을 공짜로 얻는다.

export const SESSION_COOKIE = "lw_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30일

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(`loopworks-session:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

// 상수 시간 비교 — proxy.ts의 safeEqual과 같은 이유 (타이밍으로 접두 길이 누설 방지).
function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// `<만료 epoch ms>.<HMAC>` — 페이로드가 만료시각뿐이라 서버 저장소가 필요 없다.
export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const exp = now + SESSION_MAX_AGE_S * 1000;
  return `${exp}.${await sign(String(exp), secret)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now()
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp <= now) return false;
  return safeEqual(token.slice(dot + 1), await sign(token.slice(0, dot), secret));
}
