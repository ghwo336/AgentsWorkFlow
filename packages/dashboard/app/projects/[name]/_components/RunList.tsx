import {
  agentById,
  parseAgents,
  PixelAvatar,
  ROLE_COLOR,
  ROLE_LABEL,
  seatsOf,
  type RosterRole,
} from "../../../lib/agents";
import { ERROR_STATUSES } from "@agent-loop/shared/types";
import type { Run, RunDetail } from "../../../lib/types";
import { StatusBadge } from "./StatusBadge";

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
  // 이 run의 참여 좌석 (null = 전원 — 표시는 선택 run에만), 역할별로 묶어서.
  const seatKeys = parseAgents(detail.agents);
  const team = seatKeys
    ? (["plan", "build", "verify"] as RosterRole[])
        .map((role) => ({
          role,
          members: seatsOf(role)
            .filter((s) => seatKeys.includes(s.key))
            .map((s) => agentById(s.agentId)),
        }))
        .filter((g) => g.members.length > 0)
    : null;
  return (
    <div className="panel">
      <div className="row spread">
        <b>{detail.title}</b>
        <StatusBadge status={detail.status} />
      </div>
      <div className="muted small" style={{ marginTop: 4 }}>
        {detail.targetDir}
      </div>
      {team && (
        <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
          <span className="muted small">👥 참여:</span>
          {team.map((g) => (
            <span key={g.role} className="small" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span className="muted small">{ROLE_LABEL[g.role]}</span>
              {g.members.map((a) => (
                <span
                  key={a.id}
                  style={{ display: "inline-flex", alignItems: "center", gap: 3, color: ROLE_COLOR[g.role] }}
                  title={`${a.name} · ${a.roleLabel}`}
                >
                  <PixelAvatar agent={a} size={16} />
                  {a.name}
                </span>
              ))}
            </span>
          ))}
        </div>
      )}
      {detail.commit && (
        <div className="small" style={{ marginTop: 6 }}>
          ✅ committed <code>{detail.commit.slice(0, 10)}</code>
        </div>
      )}
      {/* 실패류 상태에서만 — 재개 후 성공한 run의 옛 실패 메시지는 잔재다. */}
      {detail.error && ERROR_STATUSES.has(detail.status) && (
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
