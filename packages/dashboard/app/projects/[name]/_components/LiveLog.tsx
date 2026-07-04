"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { agentForEvent, PixelAvatar, ROLE_COLOR } from "../../../lib/agents";
import { api, LOG_PAGE } from "../../../lib/api";
import { usePagedRows } from "../../../lib/usePagedRows";
import type { RunEvent } from "../../../lib/types";

// Live timeline. Collapsed by default (raw firehose — only opened when needed);
// owns auto-scroll-to-bottom while open. The detail payload carries only the
// latest LOG_PAGE events — older ones page in via the 더보기 button on top.
export function LiveLog({
  runId,
  events,
  total,
}: {
  runId: string;
  events: RunEvent[];
  total?: number;
}) {
  const [open, setOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchOlder = useCallback((before: string) => api.olderRunEvents(runId, before), [runId]);
  const { rows, more, loading, loadOlder } = usePagedRows(runId, events, total, fetchOlder);

  // 더보기로 과거분을 앞에 붙인 직후엔 바닥으로 튀지 않는다 — 사용자는 위를
  // 읽으러 간 참이니까. 라이브 테일이 늘 때만 자동 스크롤.
  const prepended = useRef(false);
  const loadOlderKeepScroll = useCallback(async () => {
    prepended.current = true;
    await loadOlder();
  }, [loadOlder]);
  useEffect(() => {
    if (prepended.current) {
      prepended.current = false;
      return;
    }
    if (open) logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [rows.length, open]);

  return (
    <div className="panel">
      <div
        className="row spread"
        style={{ cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        <b>
          실시간 로그 <span className="muted small">({total ?? rows.length})</span>
        </b>
        <button className="ghost small" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
          {open ? "접기 ▾" : "펼치기 ▸"}
        </button>
      </div>
      {!open ? null : (
      <>
      <div style={{ height: 8 }} />
      <div className="log" ref={logRef}>
        {more > 0 && (
          <button
            className="ghost small"
            style={{ boxShadow: "none", padding: "2px 8px", alignSelf: "center" }}
            disabled={loading}
            onClick={loadOlderKeepScroll}
          >
            {loading ? "불러오는 중…" : `▴ 이전 로그 ${Math.min(LOG_PAGE, more)}개 더보기 (${more}개 남음)`}
          </button>
        )}
        {rows.map((ev) => {
          const agent = agentForEvent(ev);
          return (
            <div key={ev.id} className="line">
              <span className="ph">{ev.phase}</span>
              <span className="who" title={`${agent.name} · ${agent.engineLabel}`}>
                <PixelAvatar agent={agent} size={16} />
                <span className="who-name" style={{ color: ROLE_COLOR[agent.role] }}>
                  {agent.name}
                </span>
              </span>
              <span className={`msg${ev.level === "error" ? " err" : ev.level === "warn" ? " warn" : ""}`}>
                {ev.message}
              </span>
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
