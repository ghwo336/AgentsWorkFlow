"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Row = { id: string; ts: string };

function merge<T extends Row>(a: T[], b: T[]): T[] {
  const map = new Map(a.map((r) => [r.id, r]));
  for (const r of b) map.set(r.id, r);
  return [...map.values()].sort((x, y) =>
    x.ts === y.ts ? (x.id < y.id ? -1 : 1) : x.ts < y.ts ? -1 : 1
  );
}

// 라이브 뷰의 로그/대화 페이징 공용 훅. 상세 응답은 최신 N개만 실어 오고
// (SSE마다 새 스냅샷), 과거분은 fetchOlder(가장 오래된 행 id)로 당겨 앞에
// 붙인다. 행을 id로 중복 제거하며 누적하므로, 스냅샷 창이 밀려도 한 번 본
// 행은 사라지지 않는다. key(run id)가 바뀌면 누적분을 버린다.
export function usePagedRows<T extends Row>(
  key: string,
  latest: T[],
  total: number | undefined,
  fetchOlder: (before: string) => Promise<T[]>
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const keyRef = useRef(key);

  useEffect(() => {
    keyRef.current = key;
    setRows([]);
  }, [key]);

  useEffect(() => {
    if (latest.length) setRows((prev) => merge(prev, latest));
  }, [latest]);

  const loadOlder = useCallback(async () => {
    const oldest = rows[0];
    if (!oldest || loading) return;
    setLoading(true);
    const startedFor = keyRef.current;
    try {
      const older = await fetchOlder(oldest.id);
      // run 전환과 경합하면 이전 run의 행을 새 run에 붙이게 되므로 버린다.
      if (keyRef.current === startedFor && older.length) {
        setRows((prev) => merge(prev, older));
      }
    } finally {
      setLoading(false);
    }
  }, [rows, loading, fetchOlder]);

  const more = total !== undefined ? Math.max(0, total - rows.length) : 0;
  return { rows, more, loading, loadOlder };
}
