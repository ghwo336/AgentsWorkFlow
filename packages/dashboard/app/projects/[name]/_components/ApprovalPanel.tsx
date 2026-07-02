"use client";

import { useEffect, useState } from "react";
import { Markdown } from "../../../lib/Markdown";
import { useBusyAction } from "../../../lib/useBusyAction";

// Approval gate UI. Owns the editable plan text (re-seeded whenever a new plan
// arrives) and a feedback box that sends the plan back to Opus for revision —
// an interactive refine loop before approving.
export function ApprovalPanel({
  plan,
  onApprove,
  onReject,
  onRevise,
}: {
  plan: string;
  onApprove: (editedPlan: string) => void | Promise<void>;
  onReject: () => void | Promise<void>;
  onRevise: (feedback: string) => void | Promise<void>;
}) {
  const [editedPlan, setEditedPlan] = useState(plan);
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState(false); // preview (rendered) by default
  // Immediate feedback on click — the approve/build kick is async and the panel
  // only unmounts once the status flips, so without this the user sees nothing
  // happen for a beat and assumes the click didn't register.
  const { busy, run, reset } = useBusyAction<"approve" | "reject" | "revise">();

  useEffect(() => {
    setEditedPlan(plan);
    setFeedback(""); // a fresh plan arrived → clear the previous feedback
    setEditing(false);
    reset(); // a new/revised plan arrived → re-enable the controls
    // reset is stable per render but not memoized; keying this effect on the
    // plan alone is the intent (re-seed whenever a new plan lands).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  return (
    <div className="panel" style={{ borderColor: "var(--accent)" }}>
      <div className="row spread">
        <b>★ 계획 — 승인 / 수정</b>
        <button
          className="ghost small"
          style={{ boxShadow: "none", padding: "2px 8px" }}
          disabled={!!busy}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "👁 미리보기" : "✏️ 편집"}
        </button>
      </div>
      <div style={{ height: 8 }} />
      {editing ? (
        <textarea rows={14} value={editedPlan} onChange={(e) => setEditedPlan(e.target.value)} />
      ) : (
        <div className="plan-preview">
          <Markdown>{editedPlan}</Markdown>
        </div>
      )}
      <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
        <button disabled={!!busy} onClick={() => run("approve", () => onApprove(editedPlan))}>
          {busy === "approve" ? "⏳ 구현 시작 중…" : "✅ 승인 → 구현"}
        </button>
        <button className="danger" disabled={!!busy} onClick={() => run("reject", onReject)}>
          {busy === "reject" ? "처리 중…" : "✖ 거절"}
        </button>
        <span className="muted small" style={{ flex: "1 1 100%" }}>
          {busy === "approve"
            ? "승인됨 — 태경이 구현을 준비하고 있어요…"
            : editing
              ? "편집 후 승인하면 수정된 계획으로 진행됩니다."
              : "✏️ 편집으로 직접 고칠 수 있어요."}
        </span>
      </div>

      <div
        style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}
      >
        <div className="muted small" style={{ marginBottom: 6 }}>
          고치고 싶은 점을 적으면 Opus가 계획을 다시 세웁니다 (반복 가능):
        </div>
        <textarea
          rows={3}
          placeholder="예: 3단계가 너무 크니 둘로 나눠줘 / 인증은 JWT로 바꿔줘"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          disabled={!!busy}
        />
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button
            className="ghost"
            disabled={!feedback.trim() || !!busy}
            onClick={() => run("revise", () => onRevise(feedback.trim()))}
          >
            {busy === "revise" ? "⏳ 다시 세우는 중…" : "🔁 수정 요청"}
          </button>
        </div>
      </div>
    </div>
  );
}
