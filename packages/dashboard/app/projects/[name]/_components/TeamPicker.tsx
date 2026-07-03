"use client";

import { useMemo } from "react";
import {
  agentById,
  PixelAvatar,
  ROLE_COLOR,
  ROLE_LABEL,
  rosterOf,
  runModeOf,
  seatsOf,
  type RosterRole,
} from "../../../lib/agents";

export type TeamMode = "auto" | "manual";

// 팀 구성 선택 UI — NewTaskForm에서 분리된 단일 관심사: 모드 토글(호재 배치 /
// 직접 선택), 좌석 칩 피커, 그리고 선택 조합의 실행 모드 예고. 상태는 부모가
// 소유(controlled)하고 여기는 표시·토글만 담당한다.
export function TeamPicker({
  mode,
  selected,
  error,
  onModeChange,
  onToggleSeat,
}: {
  mode: TeamMode;
  selected: Set<string>; // seat keys
  error: string | null; // validateAgents 결과 (manual 모드에서만 의미)
  onModeChange: (mode: TeamMode) => void;
  onToggleSeat: (seatKey: string) => void;
}) {
  // 선택 조합이 어떤 모드로 도는지 한 줄 예고 (판정은 shared runModeOf 한 곳).
  const preview = useMemo(() => {
    if (mode === "auto" || error) return null;
    const r = rosterOf([...selected]);
    const noVerify = r.verifierIds.length === 0;
    switch (runModeOf(r)) {
      case "verifyOnly":
        return "🔍 검증만 — 프로젝트 현재 상태를 감사합니다 (승인·구현 없음)";
      case "planOnly":
        return "📋 기획만 — 계획서 작성 후 종료합니다";
      case "direct":
        return noVerify
          ? "🔨 바로 구현 — 승인·검증 없이 구현 후 바로 커밋합니다 (주의)"
          : "🔨 바로 구현 — 승인 단계 없이 구현하고 선택한 검증자가 리뷰합니다";
      case "full":
        return noVerify ? "⚠️ 검증 없이 진행 — 구현 결과를 리뷰 없이 커밋합니다" : null;
    }
  }, [mode, selected, error]);

  const modeChip = (value: TeamMode, label: string) => (
    <button
      type="button"
      className="badge"
      onClick={() => onModeChange(value)}
      style={{
        cursor: "pointer",
        background: "transparent",
        borderColor: mode === value ? "var(--accent)" : "var(--border)",
        color: mode === value ? "var(--accent)" : "var(--muted)",
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b className="small">👥 팀 구성</b>
        {modeChip("auto", "🤖 호재가 배치 (추천)")}
        {modeChip("manual", "🎯 직접 선택")}
      </div>
      {mode === "auto" && (
        <div className="muted small" style={{ marginTop: 6 }}>
          호재가 기획하면서 프로젝트 성격(웹/서버/iOS/Android/RN)에 맞는 개발자와
          검증자를 골라 배치합니다 — 계획 승인 화면에서 팀을 확인할 수 있어요.
        </div>
      )}
      {mode === "manual" &&
        (["plan", "build", "verify"] as RosterRole[]).map((role) => (
          <div key={role} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
            <span className="muted small" style={{ width: 30, flex: "0 0 auto" }}>
              {ROLE_LABEL[role]}
            </span>
            {seatsOf(role).map((seat) => {
              const a = agentById(seat.agentId);
              const on = selected.has(seat.key);
              return (
                <button
                  type="button"
                  key={seat.key}
                  className="badge"
                  onClick={() => onToggleSeat(seat.key)}
                  title={`${a.name} · ${seat.specialty ?? a.roleLabel} — ${on ? "참여 중, 눌러서 제외" : "제외됨, 눌러서 참여"}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    cursor: "pointer",
                    background: "transparent",
                    borderColor: on ? ROLE_COLOR[role] : "var(--border)",
                    color: on ? ROLE_COLOR[role] : "var(--muted)",
                    opacity: on ? 1 : 0.5,
                  }}
                >
                  <PixelAvatar agent={a} size={16} />
                  {a.name}
                  <span style={{ fontSize: 10 }}>{on ? "✓" : "＋"}</span>
                </button>
              );
            })}
          </div>
        ))}
      {error && (
        <div className="small" style={{ color: "var(--red)", marginTop: 6 }}>
          {error}
        </div>
      )}
      {preview && !error && (
        <div className="muted small" style={{ marginTop: 6 }}>
          {preview}
        </div>
      )}
    </div>
  );
}
