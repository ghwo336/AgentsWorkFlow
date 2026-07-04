"use client";

import { agentById, PixelAvatar } from "../lib/agents";
import { WEB_RESEARCHER, X_RESEARCHER } from "../lib/research";

// 선택 가능한 리서처 — 상현(X 실시간)·예림(웹 전반). roster 순서를 고정해
// seat 키 순서도 일정하게 유지한다.
export const RESEARCHERS = [X_RESEARCHER, WEB_RESEARCHER] as const;

// 선택(agentId 배열)을 run/후속 질문 API가 받는 seat 키(research:id)로.
export const toSeats = (picked: readonly string[]) => picked.map((r) => `research:${r}`);

// 누구에게 물을지 고르는 칩 줄 — 눌러서 켜고 끈다(파란 테두리 = 선택됨).
// 최소 한 명은 항상 켜져 있어야 하므로 마지막 한 명은 해제되지 않는다.
export function ResearcherPicker({
  picked,
  onChange,
  size = 28,
}: {
  picked: string[];
  onChange: (next: string[]) => void;
  size?: number;
}) {
  function toggle(id: string) {
    if (picked.includes(id)) {
      if (picked.length === 1) return; // 마지막 한 명은 해제 불가
      onChange(picked.filter((x) => x !== id));
    } else {
      // roster 순서를 유지하며 켠다 — seat 키 순서(상현→예림) 일정하게.
      onChange(RESEARCHERS.filter((r) => r === id || picked.includes(r)));
    }
  }

  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      {RESEARCHERS.map((id) => {
        const on = picked.includes(id);
        const a = agentById(id);
        return (
          <button
            key={id}
            type="button"
            className="ghost"
            onClick={() => toggle(id)}
            aria-pressed={on}
            title={on ? `${a.name} 끄기` : `${a.name}에게도 물어보기`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderColor: on ? "var(--accent)" : "var(--border)",
              opacity: on ? 1 : 0.5,
            }}
          >
            <PixelAvatar agent={a} size={size} />
            <span style={{ textAlign: "left", lineHeight: 1.2 }}>
              <b>{a.name}</b>
              <span className="muted small" style={{ display: "block" }}>
                {a.roleLabel}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
