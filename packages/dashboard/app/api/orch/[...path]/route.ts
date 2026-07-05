import { orchProxy } from "../../../lib/server/orch";

export const dynamic = "force-dynamic";

// 오케스트레이터 프록시의 단일 창구 — /api/orch/<orchestrator 경로> 를 그대로
// 업스트림에 전달한다 (/api/orch/data/runs → GET /data/runs, /api/orch/runs →
// POST /runs). 전에는 라우트마다 8~11줄짜리 위임 파일이 24개 있었고
// /api/orchestrator/*와 /api/runs/* 두 네임스페이스가 공존했다 — 지금은 이
// 파일 하나가 그 전부이고, 클라이언트(lib/api.ts)는 오케스트레이터 경로를
// 그대로 쓴다. SSE 스트림만 ../events/route.ts (전용 패스스루).
//
// 허용목록: Basic Auth 뒤이긴 하지만, 대시보드가 실제로 쓰는 표면만 연다 —
// 오케스트레이터에 새 라우트가 생겨도 여기 안 적으면 밖에서 안 보인다.
// 새 엔드포인트 추가 = 아래 한 줄 + api.ts 호출 하나.
const ALLOW: Record<string, RegExp[]> = {
  GET: [
    /^\/data\/runs$/,
    /^\/data\/runs\/latest$/,
    /^\/data\/runs\/[^/]+$/,
    /^\/data\/runs\/[^/]+\/(events|chat)$/,
    /^\/data\/projects$/,
    /^\/data\/projects\/[^/]+$/,
    /^\/data\/projects\/[^/]+\/plan-feed$/,
    /^\/data\/steps\/[^/]+$/,
    /^\/data\/research-folders$/,
    /^\/data\/agents\/(harnesses|learned)$/,
    /^\/data\/learning\/proposals$/,
    /^\/push\/public-key$/,
  ],
  POST: [
    /^\/runs$/,
    /^\/push\/(subscribe|unsubscribe)$/,
    /^\/runs\/[^/]+\/(approve|resume|retry|intervene-chat|research-followup)$/,
    /^\/chat$/,
    /^\/data\/projects$/,
    /^\/data\/research-folders$/,
    /^\/data\/learning\/proposals\/[^/]+$/,
  ],
  PATCH: [/^\/data\/projects\/[^/]+$/, /^\/data\/runs\/[^/]+\/folder$/],
  DELETE: [/^\/data\/research-folders\/[^/]+$/],
};

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  // 세그먼트별 인코딩 — 한글 프로젝트명 등이 경로 구분자를 오염시키지 않게.
  const upstream = `/${path.map(encodeURIComponent).join("/")}`;
  if (!(ALLOW[req.method] ?? []).some((re) => re.test(upstream))) {
    return Response.json({ error: `unknown API path: ${req.method} ${upstream}` }, { status: 404 });
  }
  const { search } = new URL(req.url);
  return orchProxy(
    `${upstream}${search}`,
    req.method === "GET" ? undefined : { method: req.method, body: await req.text() }
  );
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
