"use client";

import { useEffect, useRef, useState } from "react";
import type { Run, RunDetail, RunEvent, StartRunInput } from "../../lib/types";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge b-${status}`}>{status}</span>;
}

// New-task form. Owns its own input state and hands a completed request to the
// parent; clears the title/brief once a run actually starts.
export function NewTaskForm({
  onStart,
}: {
  onStart: (input: StartRunInput) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [targetDir, setTargetDir] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !brief) return;
    const ok = await onStart({ title, brief, targetDir: targetDir || undefined });
    if (ok) {
      setTitle("");
      setBrief("");
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <b>새 작업</b>
      <div style={{ height: 8 }} />
      <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div style={{ height: 8 }} />
      <textarea
        placeholder="기획 / 요구사항을 적어주세요…"
        rows={5}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
      <div style={{ height: 8 }} />
      <input
        placeholder="Target repo dir (선택)"
        value={targetDir}
        onChange={(e) => setTargetDir(e.target.value)}
      />
      <div style={{ height: 8 }} />
      <button type="submit">▶ Plan with Opus</button>
    </form>
  );
}

export function RunList({
  runs,
  selected,
  onSelect,
}: {
  runs: Run[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="panel">
      <b>작업 목록</b>
      <div style={{ height: 8 }} />
      {runs.map((r) => (
        <div
          key={r.id}
          className="row spread"
          style={{ padding: "6px 0", cursor: "pointer", opacity: r.id === selected ? 1 : 0.7 }}
          onClick={() => onSelect(r.id)}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.title}
          </span>
          <StatusBadge status={r.status} />
        </div>
      ))}
      {runs.length === 0 && <span className="muted small">아직 작업이 없습니다.</span>}
    </div>
  );
}

export function RunDetailCard({ detail }: { detail: RunDetail }) {
  return (
    <div className="panel">
      <div className="row spread">
        <b>{detail.title}</b>
        <StatusBadge status={detail.status} />
      </div>
      <div className="muted small" style={{ marginTop: 4 }}>
        {detail.targetDir}
      </div>
      {detail.commit && (
        <div className="small" style={{ marginTop: 6 }}>
          ✅ committed <code>{detail.commit.slice(0, 10)}</code>
        </div>
      )}
      {detail.error && (
        <div className="small" style={{ marginTop: 6, color: "var(--red)" }}>
          {detail.error}
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <a href={`/runs/${detail.id}`} className="small">
          전체 상세 보기 →
        </a>
      </div>
    </div>
  );
}

// Approval gate UI. Owns the editable plan text, re-seeding it whenever a new
// plan arrives.
export function ApprovalPanel({
  plan,
  onApprove,
  onReject,
}: {
  plan: string;
  onApprove: (editedPlan: string) => void;
  onReject: () => void;
}) {
  const [editedPlan, setEditedPlan] = useState(plan);
  useEffect(() => {
    setEditedPlan(plan);
  }, [plan]);

  return (
    <div className="panel" style={{ borderColor: "var(--accent)" }}>
      <b>★ 계획 — 승인 필요</b>
      <div style={{ height: 8 }} />
      <textarea rows={14} value={editedPlan} onChange={(e) => setEditedPlan(e.target.value)} />
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button onClick={() => onApprove(editedPlan)}>✅ 승인 → 빌드</button>
        <button className="danger" onClick={onReject}>
          ✖ 거절
        </button>
        <span className="muted small">편집 후 승인하면 수정된 계획으로 진행됩니다.</span>
      </div>
    </div>
  );
}

// Live timeline. Owns the auto-scroll-to-bottom behavior on new events.
export function LiveLog({ events }: { events: RunEvent[] }) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [events.length]);

  return (
    <div className="panel">
      <b>실시간 로그</b>
      <div style={{ height: 8 }} />
      <div className="log" ref={logRef}>
        {events.map((ev) => (
          <div key={ev.id} className="line">
            <span className="ph">{ev.phase}</span>
            <span className={ev.level === "error" ? "err" : ev.level === "warn" ? "warn" : ""}>
              {ev.model ? `[${ev.model}] ` : ""}
              {ev.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
