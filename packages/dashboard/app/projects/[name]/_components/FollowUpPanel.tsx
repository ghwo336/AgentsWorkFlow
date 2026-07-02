"use client";

import { useState } from "react";
import type { StartRunInput } from "../../../lib/types";

// Shown on a COMMITTED run: the work shipped, but software is never "done" —
// bugs surface, requirements grow. This starts a follow-up run in the same
// project folder (the pipeline plans on top of the existing code), with the
// prior run's identity baked into the brief so the planner treats it as an
// increment, not a rebuild. Without this the workspace felt like it "just
// stops" after the final commit.
export function FollowUpPanel({
  baseTitle,
  commit,
  onStart,
}: {
  baseTitle: string;
  commit?: string | null;
  onStart: (input: StartRunInput) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    const req = text.trim();
    if (!req || busy) return;
    setBusy(true);
    try {
      const brief = [
        `[후속 작업] 직전 작업 "${baseTitle}"${commit ? ` (커밋 ${commit.slice(0, 10)})` : ""}이(가) 완료된 같은 코드베이스에서 이어서 진행합니다.`,
        `기존에 동작하는 부분은 유지하고, 아래 수정/추가 요청만 반영하세요. 저장소를 먼저 읽고 현재 구조에 맞춰 계획하세요:`,
        req,
      ].join("\n\n");
      const title = `${baseTitle} — 후속: ${req.split("\n")[0].trim().slice(0, 40)}`;
      const ok = await onStart({ title, brief });
      if (ok) setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ borderColor: "var(--green)" }}>
      <b>✅ 작업 완료 — 이어서 수정/추가하기</b>
      <div className="muted small" style={{ marginTop: 4, marginBottom: 8 }}>
        버그를 찾았거나 기능을 더하고 싶으면 여기 적으세요. 같은 코드 위에서 후속 작업이
        바로 시작됩니다 (계획 → 승인 → 구현).
      </div>
      <textarea
        rows={3}
        placeholder="예: 할일 추가 버튼을 눌러도 목록에 반영이 안 됨 — POST /api/todos가 400 반환. 고쳐줘"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        <button disabled={!text.trim() || busy} onClick={go}>
          {busy ? "⏳ 시작 중…" : "🔁 이 내용으로 이어서 작업"}
        </button>
      </div>
    </div>
  );
}
