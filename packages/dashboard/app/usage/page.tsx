import { agentById, PixelAvatar, ROLE_COLOR, type Agent } from "../lib/agents";
import { orchJson } from "../lib/orch";
import { isPriced } from "@agent-loop/shared/pricing";

type UsageRow = {
  engine: string;
  model: string;
  phase: string;
  agent?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  run: { project: string };
};

export const dynamic = "force-dynamic";

const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const fmtTok = (n: number) => n.toLocaleString();

type Row = {
  engine: string;
  model: string;
  phase: string;
  agent: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  project: string;
};

// Per-agent bucket key. New rows carry the roster id; legacy rows (recorded
// before per-agent stamping) are bucketed by phase — plan was always 호재, but
// build/verify can't name the exact teammate after the fact.
function agentKeyOf(r: Row): string {
  if (r.agent) return r.agent;
  if (r.phase === "plan") return "hojae";
  if (r.phase === "build") return "legacy-build";
  return "legacy-verify";
}

// Legacy buckets render without an avatar; real ids resolve to the cast.
const LEGACY_LABEL: Record<string, string> = {
  "legacy-build": "개발팀 (이전 기록)",
  "legacy-verify": "검증팀 (이전 기록)",
};

function agentOf(key: string): Agent | null {
  return LEGACY_LABEL[key] ? null : agentById(key);
}

function tokensOf(r: Row) {
  return r.inputTokens + r.outputTokens + r.cacheRead + r.cacheWrite;
}

// Sum a numeric field over rows.
function sum<T>(rows: T[], pick: (r: T) => number) {
  return rows.reduce((acc, r) => acc + pick(r), 0);
}

// Group rows by a key, returning [key, rows][] sorted by total cost desc.
function groupBy(rows: Row[], key: (r: Row) => string): [string, Row[]][] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  return [...map.entries()].sort(
    (a, b) => sum(b[1], (r) => r.costUsd) - sum(a[1], (r) => r.costUsd)
  );
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; view?: string }>;
}) {
  const { project, view } = await searchParams;
  const agentView = view === "agents";

  const usages = await orchJson<UsageRow[]>("/data/usage");

  const allRows: Row[] = usages.map((u) => ({
    engine: u.engine,
    model: u.model,
    phase: u.phase,
    agent: u.agent ?? null,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    costUsd: u.costUsd,
    project: u.run.project,
  }));

  const projects = [...new Set(allRows.map((r) => r.project))].sort();
  const rows = project ? allRows.filter((r) => r.project === project) : allRows;

  const totalCost = sum(rows, (r) => r.costUsd);
  const totalTokens = sum(rows, tokensOf);

  const byEngine = groupBy(rows, (r) => r.engine);
  const byModel = groupBy(rows, (r) => `${r.engine}__${r.model}`);
  const byAgent = groupBy(rows, agentKeyOf);
  const byProject = groupBy(allRows, (r) => r.project);

  // Tab/filter hrefs keep the other dimension's selection.
  const href = (p?: string, v?: string) => {
    const q = new URLSearchParams();
    if (p) q.set("project", p);
    if (v) q.set("view", v);
    const s = q.toString();
    return s ? `/usage?${s}` : "/usage";
  };

  return (
    <div className="wrap">
      {/* View tabs + project filter */}
      <div className="panel">
        <div className="row spread">
          <b>💰 토큰 사용량 &amp; 비용 (API 환산)</b>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Chip label="📊 모델별" href={href(project)} active={!agentView} />
            <Chip label="👥 에이전트별" href={href(project, "agents")} active={agentView} />
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <Chip label="전체" href={href(undefined, agentView ? "agents" : undefined)} active={!project} />
          {projects.map((p) => (
            <Chip
              key={p}
              label={p}
              href={href(p, agentView ? "agents" : undefined)}
              active={project === p}
            />
          ))}
        </div>
        <div className="muted small" style={{ marginTop: 8 }}>
          Codex는 ChatGPT 구독으로 실행되어 실제 API 청구가 없습니다 — 아래 금액은
          동일 기준 비교를 위한 <b>API 요금 환산 추정치</b>입니다.
        </div>
      </div>

      {/* Headline totals */}
      <div className="row stats" style={{ gap: 16, alignItems: "stretch" }}>
        <Stat label={project ? `${project} 총 비용` : "총 비용 (전체)"} value={fmtUsd(totalCost)} />
        <Stat label="총 토큰" value={fmtTok(totalTokens)} />
        {byEngine.map(([engine, er]) => (
          <Stat
            key={engine}
            label={`${engine} 비용`}
            value={fmtUsd(sum(er, (r) => r.costUsd))}
            sub={`${fmtTok(sum(er, tokensOf))} tok`}
          />
        ))}
      </div>

      {/* Per-agent breakdown (에이전트별 탭) */}
      {agentView && (
        <div className="panel">
          <b>에이전트별 사용량</b>
          <div className="table-scroll">
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>에이전트</th>
                  <th>직책</th>
                  <th style={{ textAlign: "right" }}>Input</th>
                  <th style={{ textAlign: "right" }}>Output</th>
                  <th style={{ textAlign: "right" }}>Cache R/W</th>
                  <th style={{ textAlign: "right" }}>총 토큰</th>
                  <th style={{ textAlign: "right" }}>비용</th>
                </tr>
              </thead>
              <tbody>
                {byAgent.map(([key, ar]) => {
                  const agent = agentOf(key);
                  return (
                    <tr key={key}>
                      <td>
                        {agent ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <PixelAvatar agent={agent} size={22} />
                            <b style={{ color: ROLE_COLOR[agent.role] }}>{agent.name}</b>
                          </span>
                        ) : (
                          <span className="muted">{LEGACY_LABEL[key] ?? key}</span>
                        )}
                      </td>
                      <td className="muted small">
                        {agent ? `${agent.roleLabel} · ${agent.engineLabel}` : "에이전트 기록 이전 데이터"}
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtTok(sum(ar, (r) => r.inputTokens))}</td>
                      <td style={{ textAlign: "right" }}>{fmtTok(sum(ar, (r) => r.outputTokens))}</td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {fmtTok(sum(ar, (r) => r.cacheRead))} / {fmtTok(sum(ar, (r) => r.cacheWrite))}
                      </td>
                      <td style={{ textAlign: "right" }}>{fmtTok(sum(ar, tokensOf))}</td>
                      <td style={{ textAlign: "right" }}>{fmtUsd(sum(ar, (r) => r.costUsd))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="muted">아직 기록된 사용량이 없습니다.</p>}
          <div className="muted small" style={{ marginTop: 8 }}>
            성호(빌드 검사)는 모델을 쓰지 않는 결정적 검사라 토큰이 거의 기록되지 않습니다. 과거
            기록은 담당자 스탬프가 없어 팀 단위로 묶입니다.
          </div>
        </div>
      )}

      {/* Per-model breakdown */}
      {!agentView && (
      <div className="panel">
        <b>모델별 사용량</b>
        <div className="table-scroll">
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Engine</th>
              <th>Model</th>
              <th style={{ textAlign: "right" }}>Input</th>
              <th style={{ textAlign: "right" }}>Output</th>
              <th style={{ textAlign: "right" }}>Cache R/W</th>
              <th style={{ textAlign: "right" }}>총 토큰</th>
              <th style={{ textAlign: "right" }}>비용</th>
            </tr>
          </thead>
          <tbody>
            {byModel.map(([k, mr]) => {
              const [engine, model] = k.split("__");
              return (
                <tr key={k}>
                  <td>
                    <span className={`badge b-${engine === "codex" ? "verifying" : "committed"}`}>
                      {engine}
                    </span>
                  </td>
                  <td>
                    <code>{model}</code>
                    {!isPriced(model) && (
                      <span className="muted small" title="가격표에 없어 기본 추정 요율 적용"> ⚠︎</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtTok(sum(mr, (r) => r.inputTokens))}</td>
                  <td style={{ textAlign: "right" }}>{fmtTok(sum(mr, (r) => r.outputTokens))}</td>
                  <td style={{ textAlign: "right" }} className="muted">
                    {fmtTok(sum(mr, (r) => r.cacheRead))} / {fmtTok(sum(mr, (r) => r.cacheWrite))}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtTok(sum(mr, tokensOf))}</td>
                  <td style={{ textAlign: "right" }}>{fmtUsd(sum(mr, (r) => r.costUsd))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {rows.length === 0 && <p className="muted">아직 기록된 사용량이 없습니다.</p>}
      </div>
      )}

      {/* Per-project breakdown (only in "all" view) */}
      {!agentView && !project && byProject.length > 0 && (
        <div className="panel">
          <b>프로젝트별 비용</b>
          <div className="table-scroll">
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Project</th>
                <th style={{ textAlign: "right" }}>Claude</th>
                <th style={{ textAlign: "right" }}>Codex</th>
                <th style={{ textAlign: "right" }}>총 토큰</th>
                <th style={{ textAlign: "right" }}>총 비용</th>
              </tr>
            </thead>
            <tbody>
              {byProject.map(([p, pr]) => (
                <tr key={p}>
                  <td>
                    <a href={`/usage?project=${encodeURIComponent(p)}`}>{p}</a>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {fmtUsd(sum(pr.filter((r) => r.engine === "claude"), (r) => r.costUsd))}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {fmtUsd(sum(pr.filter((r) => r.engine === "codex"), (r) => r.costUsd))}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtTok(sum(pr, tokensOf))}</td>
                  <td style={{ textAlign: "right" }}>{fmtUsd(sum(pr, (r) => r.costUsd))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel" style={{ flex: 1, marginBottom: 16 }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

function Chip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <a
      href={href}
      className="badge"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border)",
        color: active ? "var(--accent)" : "var(--muted)",
      }}
    >
      {label}
    </a>
  );
}
