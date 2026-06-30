import { prisma } from "@agent-loop/shared/db";
import { notFound } from "next/navigation";
import { DiffView } from "./DiffView";

export const dynamic = "force-dynamic";

export default async function RunDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await prisma.run.findUnique({
    where: { id },
    include: {
      events: { orderBy: { ts: "asc" } },
      verdicts: { orderBy: { ts: "asc" } },
    },
  });
  if (!run) notFound();

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
          <b>Approved plan (Opus)</b>
          <pre className="diff" style={{ whiteSpace: "pre-wrap" }}>{run.plan}</pre>
        </div>
      )}

      {/* codex verdicts — including every rejection with its full reason */}
      <div className="panel">
        <b>codex 검증 내역</b>
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
          {run.events.map((ev) => (
            <div key={ev.id} className="line">
              <span className="ph">{ev.phase}</span>
              <span className={ev.level === "error" ? "err" : ev.level === "warn" ? "warn" : ""}>
                {ev.model ? `[${ev.model}] ` : ""}
                {ev.message}
              </span>
              <span className="muted small" style={{ marginLeft: "auto" }}>
                {new Date(ev.ts).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
