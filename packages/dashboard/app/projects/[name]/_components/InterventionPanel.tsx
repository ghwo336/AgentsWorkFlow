"use client";

import { useState } from "react";
import { agentById, PixelAvatar, ROLE_COLOR } from "../../../lib/agents";
import { Markdown } from "../../../lib/Markdown";
import { useBusyAction } from "../../../lib/useBusyAction";

// Intervention gate: shown when a step is stuck (needs_input) — after the
// builders' retries AND 호재's escalation both failed. The user is the final
// escalation: give fix guidance (re-runs the step), accept the current attempt
// as-is, skip the step, or stop the run.
export function InterventionPanel({
  reason,
  onGuide,
  onCommit,
  onSkip,
  onAbort,
}: {
  reason?: string | null;
  onGuide: (feedback: string) => void | Promise<void>;
  onCommit: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  onAbort: () => void | Promise<void>;
}) {
  const [feedback, setFeedback] = useState("");
  const { busy, run } = useBusyAction<"guide" | "commit" | "skip" | "abort">();
  const hojae = agentById("hojae");

  return (
    <div className="panel" style={{ borderColor: "var(--yellow)" }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <PixelAvatar agent={hojae} size={28} />
        <b>🚧 막힌 단계 — 개입이 필요해요</b>
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>
        태경·민재가 여러 번 시도하고 <b style={{ color: ROLE_COLOR.plan }}>호재</b>가 개입해 해결책까지
        제시했지만 이 단계가 검증을 통과하지 못했습니다. 어떻게 진행할까요?
      </div>
      {reason && (
        <div className="plan-preview" style={{ marginTop: 10 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>마지막 검증 사유</div>
          <Markdown>{reason}</Markdown>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div className="muted small" style={{ marginBottom: 6 }}>
          직접 지침을 주면 그대로 이 단계를 다시 시도합니다 (가장 권장):
        </div>
        <textarea
          rows={3}
          placeholder="예: prisma를 6.x로 낮춰서 @auth/prisma-adapter와 맞춰줘 / next는 15.3.4 정확히 써"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          disabled={!!busy}
        />
        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
          <button
            disabled={!feedback.trim() || !!busy}
            onClick={() => run("guide", () => onGuide(feedback.trim()))}
          >
            {busy === "guide" ? "⏳ 다시 시도 중…" : "🧭 지침 주고 다시 시도"}
          </button>
          <button className="ghost" disabled={!!busy} onClick={() => run("commit", onCommit)}>
            {busy === "commit" ? "처리 중…" : "✅ 현재 상태로 커밋"}
          </button>
          <button className="ghost" disabled={!!busy} onClick={() => run("skip", onSkip)}>
            {busy === "skip" ? "처리 중…" : "⏭️ 이 단계 건너뛰기"}
          </button>
          <button className="danger" disabled={!!busy} onClick={() => run("abort", onAbort)}>
            {busy === "abort" ? "처리 중…" : "✖ 중단"}
          </button>
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          <b>커밋</b>: 지금까지의 변경을 그대로 확정하고 다음 단계로 · <b>건너뛰기</b>: 이 단계 변경을
          버리고 다음 단계로 · <b>중단</b>: 작업 종료.
        </div>
      </div>
    </div>
  );
}
