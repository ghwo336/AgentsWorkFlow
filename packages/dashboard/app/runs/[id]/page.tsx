import { notFound } from "next/navigation";
import { ORCH_URL } from "../../lib/orch";
import { DiffView } from "./DiffView";
import { agentById, agentForEvent, PixelAvatar, ROLE_COLOR } from "../../lib/agents";

export const dynamic = "force-dynamic";

type RunEventRow = { id: string; phase: string; level: string; message: string; ts: string; model?: string | null };
type VerdictRow = { id: string; attempt: number; passed: boolean; ts: string; reason: string; diff?: string | null };
type RunRow = {
  id: string;
  title: string;
  status: string;
  brief: string;
  agents?: string | null;
  targetDir?: string | null;
  commit?: string | null;
  error?: string | null;
  plan?: string | null;
  events: RunEventRow[];
  verdicts: VerdictRow[];
};

export default async function RunDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Fetched from the orchestrator (DB owner) rather than opening SQLite here.
  const res = await fetch(`${ORCH_URL}/data/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`run detail → HTTP ${res.status}`);
  const run: RunRow = await res.json();

  return (
    <div className="wrap">
      <div className="panel">
        <div className="row spread">
          <b>{run.title}</b>
          <span className={`badge b-${run.status}`}>{run.status}</span>
        </div>
        <p className="muted small">{run.brief}</p>
        <div className="muted small">{run.targetDir}</div>
        {run.commit && (
          <p className="small">✅ committed <code>{run.commit}</code></p>
        )}
        {run.error && <p className="small" style={{ color: "var(--red)" }}>{run.error}</p>}
      </div>

      {run.plan && (
        <div className="panel">
          {/* 리서치 run의 plan 칼럼에는 상현의 보고서가 담긴다 — 주인을 맞춰 표시 */}
          {(run.agents ?? "").includes("research:") ? (
            <b className="agent-chip">
              <PixelAvatar agent={agentById("sanghyun")} size={22} />
              <span style={{ color: ROLE_COLOR.research }}>상현의 리서치 보고서</span>
              <span className="muted small">(Opus)</span>
            </b>
          ) : (
            <b className="agent-chip">
              <PixelAvatar agent={agentById("hojae")} size={22} />
              <span style={{ color: ROLE_COLOR.plan }}>호재의 기획안</span>
              <span className="muted small">(Opus)</span>
            </b>
          )}
          <pre className="diff" style={{ whiteSpace: "pre-wrap" }}>{run.plan}</pre>
        </div>
      )}

      {/* codex verdicts — including every rejection with its full reason */}
      <div className="panel">
        <b className="agent-chip">
          <PixelAvatar agent={agentById("juho")} size={22} />
          <span style={{ color: ROLE_COLOR.verify }}>검증 내역</span>
          <span className="muted small">(주호·동환 / codex)</span>
        </b>
        {run.verdicts.length === 0 && <p className="muted small">아직 검증 없음.</p>}
        {run.verdicts.map((v) => (
          <div key={v.id} style={{ marginTop: 12 }}>
            <div className="row spread">
              <span>
                Attempt {v.attempt}{" "}
                <span className={`badge ${v.passed ? "b-committed" : "b-rejected"}`}>
                  {v.passed ? "PASS" : "FAIL"}
                </span>
              </span>
              <span className="muted small">{new Date(v.ts).toLocaleString()}</span>
            </div>
            <p className="small" style={{ whiteSpace: "pre-wrap" }}>{v.reason}</p>
            {v.diff && <DiffView diff={v.diff} />}
          </div>
        ))}
      </div>

      <div className="panel">
        <b>Timeline</b>
        <div className="log" style={{ maxHeight: "none", marginTop: 8 }}>
          {run.events.map((ev) => {
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
                <span className="muted small" style={{ marginLeft: "auto" }}>
                  {new Date(ev.ts).toLocaleTimeString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
