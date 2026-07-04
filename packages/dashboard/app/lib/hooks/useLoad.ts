"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errMsg } from "../err";

// 화면 데이터 로딩 공용 훅 — 컴포넌트마다 반복되던 load(useCallback) +
// useEffect 재조회 + try/catch 에러 문구 패턴을 묶는다.
//
// - deps가 바뀔 때마다 다시 읽는다 (refreshKey, run id 등).
// - initial을 주면 첫 데이터는 서버 컴포넌트가 HTML에 실어 온 것이므로
//   마운트 시에는 다시 읽지 않고, 이후 deps 변화부터 읽는다.
// - resetKey가 바뀌면 새 응답이 오기 전까지 data를 비운다 — 스레드/탭 전환
//   시 이전 화면 데이터가 잠깐 비치는 것을 막는다.
// - 조회가 겹치면(전환 직후 등) 뒤늦게 도착한 이전 응답은 버린다.
export function useLoad<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts: { initial?: T; errorLabel?: string; resetKey?: unknown } = {}
) {
  const [data, setData] = useState<T | null>(opts.initial ?? null);
  const [error, setError] = useState<string | null>(null);

  // fetcher/errorLabel은 렌더마다 새로 만들어져도 재조회를 일으키지 않도록
  // ref로 들고, 재조회 시점은 deps로만 결정한다.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const labelRef = useRef(opts.errorLabel);
  labelRef.current = opts.errorLabel;
  // 조회 세대 — 응답이 도착했을 때 세대가 다르면 이미 낡은 응답이다.
  const genRef = useRef(0);

  const resetRef = useRef(opts.resetKey);
  if (resetRef.current !== opts.resetKey) {
    resetRef.current = opts.resetKey;
    genRef.current++; // 진행 중이던 이전 키의 조회를 무효화
    if (data !== null) setData(null);
  }

  const reload = useCallback(async () => {
    const gen = ++genRef.current;
    try {
      const next = await fetcherRef.current();
      if (genRef.current !== gen) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (genRef.current !== gen) return;
      setError(errMsg(err, labelRef.current ?? "로드 실패"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const skipFirst = useRef(opts.initial !== undefined);
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    reload();
  }, [reload]);

  return { data, error, reload };
}
