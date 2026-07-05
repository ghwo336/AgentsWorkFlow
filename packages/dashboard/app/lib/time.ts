// 시각 표시는 전부 한국시간(Asia/Seoul) 고정. 대시보드는 도커 컨테이너(UTC)
// 에서 서버 렌더링되므로 런타임 로컬 TZ에 맡기면 UTC로 찍히고, 클라이언트
// 컴포넌트도 SSR(UTC) → 하이드레이션(브라우저 TZ)이 어긋난다. Intl에 TZ를
// 박으면 어디서 렌더링해도 같은 문자열이 나온다. React 없음 — 서버/클라이언트
// 양쪽에서 import 가능.
const KST = "Asia/Seoul";

const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: KST,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type Parts = { y: string; mo: string; d: string; h: string; mi: string; s: string };

function kst(iso: string | Date): Parts {
  const g: Record<string, string> = {};
  for (const p of FMT.formatToParts(new Date(iso))) g[p.type] = p.value;
  return { y: g.year, mo: g.month, d: g.day, h: g.hour, mi: g.minute, s: g.second };
}

// "2026. 7. 6. 17:39:21" — 히스토리/판정 카드 같은 전체 타임스탬프.
export function fmtDateTime(iso: string | Date): string {
  const p = kst(iso);
  return `${p.y}. ${p.mo}. ${p.d}. ${p.h}:${p.mi}:${p.s}`;
}

// "17:39:21" — 타임라인처럼 날짜 문맥이 이미 있는 곳.
export function fmtTimeOfDay(iso: string | Date): string {
  const p = kst(iso);
  return `${p.h}:${p.mi}:${p.s}`;
}

// "7/6 17:39" — 피드/카드의 컴팩트 타임스탬프.
export function fmtShort(iso: string | Date): string {
  const p = kst(iso);
  return `${p.mo}/${p.d} ${p.h}:${p.mi}`;
}

// 오늘이면 "17:39", 아니면 "7/6 17:39" — "오늘"도 KST 기준으로 판정.
export function fmtClock(iso: string | Date): string {
  const p = kst(iso);
  const now = kst(new Date());
  const hm = `${p.h}:${p.mi}`;
  return p.y === now.y && p.mo === now.mo && p.d === now.d ? hm : `${p.mo}/${p.d} ${hm}`;
}
