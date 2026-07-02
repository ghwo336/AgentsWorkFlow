"use client";

import { Markdown } from "../../../lib/Markdown";
import { useBusyAction } from "../../../lib/useBusyAction";

// Shown when a run has stopped (rejected/failed). Lets the user re-open it and
// continue from where it left off — the build resumes at the first uncommitted
// step, now with the retry + 호재 escalation ladder (which older runs never had).
export function ResumePanel({
  reason,
  onRetry,
}: {
  reason?: string | null;
  onRetry: () => void | Promise<void>;
}) {
  const { busy, run } = useBusyAction<"retry">();
  return (
    <div className="panel" style={{ borderColor: "var(--accent)" }}>
      <b>⏹ 작업이 중단됨</b>
      <div className="muted small" style={{ marginTop: 6 }}>
        이 작업은 멈춘 상태입니다. <b>다시 진행</b>하면 이미 커밋된 단계는 건너뛰고 멈춘 단계부터
        이어서 시도합니다 (재시도 + 호재 개입 포함).
      </div>
      {reason && (
        <div className="plan-preview" style={{ marginTop: 10 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>중단 사유</div>
          <Markdown>{reason}</Markdown>
        </div>
      )}
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button disabled={!!busy} onClick={() => run("retry", onRetry)}>
          {busy ? "⏳ 재개 중…" : "▶ 다시 진행 (멈춘 단계부터)"}
        </button>
      </div>
    </div>
  );
}
