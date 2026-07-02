"use client";

import { useEffect, useRef, useState } from "react";
import { agentForEvent, PixelAvatar, ROLE_COLOR } from "../../../lib/agents";
import type { RunEvent } from "../../../lib/types";

// Live timeline. Collapsed by default (raw firehose — only opened when needed);
// owns auto-scroll-to-bottom while open.
export function LiveLog({ events }: { events: RunEvent[] }) {
  const [open, setOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [events.length, open]);

  return (
    <div className="panel">
      <div
        className="row spread"
        style={{ cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        <b>
          실시간 로그 <span className="muted small">({events.length})</span>
        </b>
        <button className="ghost small" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
          {open ? "접기 ▾" : "펼치기 ▸"}
        </button>
      </div>
      {!open ? null : (
      <>
      <div style={{ height: 8 }} />
      <div className="log" ref={logRef}>
        {events.map((ev) => {
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
              <span className={ev.level === "error" ? "err" : ev.level === "warn" ? "warn" : ""}>
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
