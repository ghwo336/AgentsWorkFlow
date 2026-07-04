"use client";

import { useCallback, useEffect, useState } from "react";
import { agentById, PixelAvatar, RESEARCH_PROJECT, ROLE_COLOR } from "../lib/agents";
import { api } from "../lib/api";
import { Markdown } from "../lib/Markdown";
import type { Run, RunDetail } from "../lib/types";

// 홈의 🔍 리서치 탭 — 프로젝트/코드 파이프라인과 분리된 리서치 전용 화면.
// 질문을 제출하면 상현(리서처) 단독 run이 예약 프로젝트(RESEARCH_PROJECT)에
// 생기고, 완료되면 보고서(run.plan)를 여기서 바로 읽는다.

const RESEARCHER = "sanghyun";
const RESEARCH_SEAT = `research:${RESEARCHER}`;

// refreshKey: 부모(HomeClient)가 SSE 이벤트마다 올려주는 카운터 — 값이 바뀔
// 때마다 목록과 열려 있는 상세를 다시 읽는다 (EventSource는 부모 것 하나만 사용).
export function ResearchTab({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [question, setQuestion] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.listRuns(RESEARCH_PROJECT);
      setRuns(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "리서치 목록 로드 실패");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await api.getRun(id));
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail, refreshKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || starting) return;
    setStarting(true);
    try {
      const title = q.length > 60 ? `${q.slice(0, 60)}…` : q;
      const { id } = await api.startRun({
        project: RESEARCH_PROJECT,
        title,
        brief: q,
        agents: [RESEARCH_SEAT],
      });
      setQuestion("");
      setSelectedId(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "리서치 시작 실패");
    } finally {
      setStarting(false);
    }
  }

  const sanghyun = agentById(RESEARCHER);

  return (
    <>
      <form className="panel" onSubmit={submit}>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <PixelAvatar agent={sanghyun} size={40} />
          <div>
            <b className="pixel">🔍 새 리서치</b>
            <div className="muted small" style={{ marginTop: 2 }}>
              상현이 웹을 조사해서 근거 있는 보고서로 답해요.
            </div>
          </div>
        </div>
        <div style={{ height: 10 }} />
        <textarea
          placeholder="궁금한 것을 물어보세요 (예: 2026년 기준 Next.js와 Remix 중 무엇을 쓰는 게 좋을까? 근거와 함께)"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ height: 8 }} />
        <button type="submit" disabled={starting || !question.trim()}>
          {starting ? "시작하는 중…" : "조사 시작 →"}
        </button>
      </form>

      <div className="panel">
        <b>리서치 기록</b>
        <div style={{ height: 12 }} />
        {error && (
          <div className="small" style={{ color: "var(--red)", marginBottom: 10 }}>
            {error}
          </div>
        )}
        <div style={{ display: "grid", gap: 10 }}>
          {runs.map((r) => (
            <button
              key={r.id}
              type="button"
              className="row spread"
              onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
              style={{
                padding: "12px 14px",
                border: `1px solid ${selectedId === r.id ? ROLE_COLOR.research : "var(--border)"}`,
                borderRadius: 8,
                background: "transparent",
                color: "var(--text)",
                textAlign: "left",
                cursor: "pointer",
                boxShadow: "none",
                fontWeight: 400,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                <div className="muted small" style={{ marginTop: 2 }}>
                  {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <span className={`badge b-${r.status}`}>{r.status}</span>
            </button>
          ))}
          {runs.length === 0 && (
            <span className="muted small">아직 리서치가 없습니다. 위에서 질문해 보세요.</span>
          )}
        </div>
      </div>

      {selectedId && detail && <ResearchReport detail={detail} onRetry={load} />}
    </>
  );
}

function ResearchReport({ detail, onRetry }: { detail: RunDetail; onRetry: () => void }) {
  const sanghyun = agentById(RESEARCHER);
  const running = detail.status === "researching" || detail.status === "planning";
  const lastEvents = detail.events.slice(-5);

  return (
    <div className="panel">
      <div className="row spread" style={{ alignItems: "flex-start" }}>
        <b className="agent-chip">
          <PixelAvatar agent={sanghyun} size={22} active={running} />
          <span style={{ color: ROLE_COLOR.research }}>상현의 리서치 보고서</span>
          <span className="muted small">({sanghyun.engineLabel})</span>
        </b>
        <span className={`badge b-${detail.status}`}>{detail.status}</span>
      </div>
      <div className="muted small" style={{ margin: "8px 0" }}>
        {detail.brief}
      </div>

      {running && (
        <div style={{ marginTop: 8 }}>
          <div className="small">🔎 조사 중… 완료되면 여기에 보고서가 나타나요.</div>
          <div className="log" style={{ marginTop: 8 }}>
            {lastEvents.map((ev) => (
              <div key={ev.id} className="line">
                <span className={ev.level === "error" ? "err" : ev.level === "warn" ? "warn" : ""}>
                  {ev.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {detail.error && (
        <div className="small" style={{ color: "var(--red)", marginTop: 8, whiteSpace: "pre-wrap" }}>
          {detail.error}
        </div>
      )}
      {!running && !detail.plan && (
        <button type="button" style={{ marginTop: 8 }} onClick={() => api.retry(detail.id).then(onRetry)}>
          다시 조사하기
        </button>
      )}

      {detail.plan && (
        <div style={{ marginTop: 10 }}>
          <Markdown>{detail.plan}</Markdown>
        </div>
      )}
    </div>
  );
}
