import { prisma } from "@agent-loop/shared/db";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const runs = await prisma.run.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { _count: { select: { verdicts: true } } },
  });

  return (
    <div className="wrap">
      <div className="panel">
        <b>작업 내역 (History)</b>
        <div className="table-scroll">
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Task</th>
              <th>Project</th>
              <th>Status</th>
              <th>Verify attempts</th>
              <th>Commit</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/runs/${r.id}`}>{r.title}</a>
                </td>
                <td className="muted small">{r.project}</td>
                <td>
                  <span className={`badge b-${r.status}`}>{r.status}</span>
                </td>
                <td>{r._count.verdicts}</td>
                <td>
                  {r.commit ? <code>{r.commit.slice(0, 10)}</code> : <span className="muted">—</span>}
                </td>
                <td className="muted small">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {runs.length === 0 && <p className="muted">아직 작업이 없습니다.</p>}
      </div>
    </div>
  );
}
