"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { agentById } from "../../../lib/agents";
import { api } from "../../../lib/api";
import { Markdown } from "../../../lib/Markdown";
import type { PlanFeedRun } from "../../../lib/types";

// 기획 스레드 — 프로젝트의 기획 활동 전체를 하나의 대화 피드로 그린다:
// 내 요청(말풍선) → 호재의 계획(단계 요약 카드, 전문은 펼침) → 수정 요청
// 말풍선 → 수정본 카드 → 결과 줄(완료/실패/막힘) → 후속 요청 …
//
// 입력창은 맨 아래 하나뿐이고, 무슨 뜻으로 보낼지는 마지막 run의 상태가
// 정한다 (승인 대기 = 수정 요청, 막힘 = 지침, 끝난 작업 = 후속 기획).
// 사용자는 "뭘 추가해/고쳐줘"라고 말만 하면 되고, 라우팅은 시스템 몫이다.
// 클릭으로 끝나는 결정(승인·거절·재시도·커밋 등)만 해당 카드 안 버튼으로.

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const parseJsonArr = (json?: string | null): (string | null)[] => {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

// 마지막 run의 상태 → 입력창의 의미. 사용자가 구분을 몰라도 되도록 여기서 정한다.
type InputMode = "revise" | "guide" | "follow" | "locked";
const RUNNING = new Set(["planning", "building", "verifying", "researching"]);

function inputModeOf(last: PlanFeedRun | undefined): InputMode {
  if (!last) return "follow"; // 호출부가 빈 피드에선 이 컴포넌트를 쓰지 않는다
  if (last.status === "awaiting_approval") return "revise";
  if (last.status === "needs_input") return "guide";
  if (RUNNING.has(last.status)) return "locked";
  return "follow"; // committed | failed | rejected | cancelled | reported
}

const MODE_HINT: Record<InputMode, (last: PlanFeedRun) => string> = {
  revise: () => "지금 보내면: 승인 대기 중인 계획에 수정 요청",
  guide: () => "지금 보내면: 막힌 작업에 지침 전달 — 그 지점부터 다시 진행합니다",
  follow: (last) =>
    last.status === "committed" || last.status === "reported"
      ? "지금 보내면: 완료된 작업에 이어지는 후속 기획 (추가든 재작업이든)"
      : "지금 보내면: 직전 작업의 결말(실패/거절)을 알고 새로 기획",
  locked: () => "팀이 작업 중이에요 — 끝나면 이어서 말할 수 있습니다",
};

// 내 말풍선 — 긴 요구(스펙 문서 통째로 등)는 접어서 리듬을 지킨다.
function UserBubble({ text, ts }: { text: string; ts: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280;
  return (
    <div className="chat-msg chat-user feed-turn">
      <span className="chat-who">나 · {fmtTime(ts)}</span>
      <div className="chat-bubble">
        {long && !open ? `${text.slice(0, 280)}…` : text}
        {long && (
          <button type="button" className="feed-inline-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? "접기" : "더보기"}
          </button>
        )}
      </div>
    </div>
  );
}

// 계획 카드 — 기본은 "N단계로 나눴어요 + 단계 목록"의 요약만. 전문(마크다운
// 문서)은 펼칠 때 상세 API에서 lazy 로드한다 (피드 payload를 가볍게 유지).
function PlanCard({
  run,
  version, // 이 카드가 그리는 revision 버전 (없으면 revision 없는 legacy run)
  label,
  ts,
  isLatestOfRun,
  awaiting,
  busy,
  onApprove,
  onReject,
}: {
  run: PlanFeedRun;
  version: number | null;
  label: string;
  ts: string;
  isLatestOfRun: boolean;
  awaiting: boolean;
  busy: string | null;
  onApprove: (runId: string, editedPlan?: string) => void;
  onReject: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState("");

  // 단계 요약은 최신 버전에만 — planSteps는 항상 마지막 계획을 반영하므로
  // 옛 버전에 붙이면 거짓말이 된다.
  const steps = isLatestOfRun ? (parseJsonArr(run.planSteps) as string[]) : [];
  const devs = isLatestOfRun ? parseJsonArr(run.stepDevs) : [];

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (text !== null || loading) return;
    setLoading(true);
    try {
      const detail = await api.getRun(run.id);
      const revs = (detail.planRevisions ?? []) as Array<{ version: number; text: string }>;
      const t =
        version !== null
          ? (revs.find((r) => r.version === version)?.text ?? detail.plan ?? "")
          : (detail.plan ?? "");
      setText(t);
      setEdited(t);
    } catch {
      setText("(전문을 불러오지 못했습니다 — 다시 열어보세요)");
      setLoading(false);
      return;
    }
    setLoading(false);
  }

  return (
    <div className="chat-msg chat-assistant feed-turn">
      <span className="chat-who">
        호재 · {label} · {fmtTime(ts)}
      </span>
      <div className={`chat-bubble feed-plan-card${awaiting ? " feed-awaiting" : ""}`}>
        {steps.length > 0 ? (
          <>
            <div className="small" style={{ marginBottom: 6 }}>
              {steps.length}단계로 나눴어요:
            </div>
            <ol className="feed-steps">
              {steps.map((s, i) => {
                const dev = devs[i] ? agentById(String(devs[i])) : null;
                return (
                  <li key={i}>
                    {s}
                    {dev && <span className="muted small"> — {dev.name}</span>}
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <div className="muted small">계획 문서가 준비됐어요 — 전문에서 확인하세요.</div>
        )}

        <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="ghost small feed-btn" onClick={toggle}>
            {open ? "전문 접기 ▴" : "📄 전문 보기 ▾"}
          </button>
          {awaiting && (
            <>
              <button
                type="button"
                className="small feed-btn"
                disabled={!!busy}
                onClick={() => onApprove(run.id, editing ? edited : undefined)}
              >
                {busy === "approve" ? "⏳ 시작 중…" : editing ? "✅ 수정본으로 승인" : "✅ 승인 → 구현"}
              </button>
              <button
                type="button"
                className="danger small feed-btn"
                disabled={!!busy}
                onClick={() => onReject(run.id)}
              >
                ✖ 거절
              </button>
            </>
          )}
        </div>

        {open && (
          <div className="feed-plan-full">
            {loading && <div className="muted small">불러오는 중…</div>}
            {!loading && text !== null && !editing && <div className="md"><Markdown>{text}</Markdown></div>}
            {!loading && editing && (
              <textarea rows={14} value={edited} onChange={(e) => setEdited(e.target.value)} />
            )}
            {!loading && awaiting && text !== null && (
              <button
                type="button"
                className="ghost small feed-btn"
                style={{ marginTop: 6 }}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? "👁 미리보기로" : "✏️ 직접 편집"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// run의 결말/현황 한 줄 — "미숙했다"고 말하려면 뭐가 어떻게 끝났는지가
// 그 자리에서 보여야 하므로, 결과가 피드의 정식 항목으로 낀다.
function ResultLine({
  run,
  busy,
  onQuickIntervene,
  onRetry,
  onOpenRun,
}: {
  run: PlanFeedRun;
  busy: string | null;
  onQuickIntervene: (runId: string, action: "commit" | "skip" | "abort") => void;
  onRetry: (runId: string) => void;
  onOpenRun: (runId: string) => void;
}) {
  const openBtn = (
    <button type="button" className="feed-inline-toggle" onClick={() => onOpenRun(run.id)}>
      작업 보기 →
    </button>
  );
  switch (run.status) {
    case "committed":
      return (
        <div className="feed-result ok">
          ✅ 구현 완료{run.commit ? <> — 커밋 <code>{run.commit.slice(0, 10)}</code></> : null} {openBtn}
        </div>
      );
    case "reported":
      return <div className="feed-result ok">📄 리서치 보고 완료 {openBtn}</div>;
    case "awaiting_approval":
      return (
        <div className="feed-result wait">
          ★ 계획 승인 대기 중 — 위 카드에서 승인하거나, 아래에 수정 요청을 적으세요.
        </div>
      );
    case "planning":
      return <div className="feed-result run">📝 호재가 기획 중…</div>;
    case "building":
    case "verifying":
      return <div className="feed-result run">🔨 팀이 구현 중… {openBtn}</div>;
    case "researching":
      return <div className="feed-result run">🔎 리서치 진행 중… {openBtn}</div>;
    case "needs_input":
      return (
        <div className="feed-result warn">
          🖐 막힘 — {run.error || "사용자 결정이 필요합니다"}
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="ghost small feed-btn"
              disabled={!!busy}
              onClick={() => onQuickIntervene(run.id, "commit")}
            >
              현재 상태로 커밋
            </button>
            <button
              type="button"
              className="ghost small feed-btn"
              disabled={!!busy}
              onClick={() => onQuickIntervene(run.id, "skip")}
            >
              이 단계 건너뛰기
            </button>
            <button
              type="button"
              className="danger small feed-btn"
              disabled={!!busy}
              onClick={() => window.confirm("작업을 중단할까요?") && onQuickIntervene(run.id, "abort")}
            >
              중단
            </button>
            <span className="muted small">지침을 주려면 아래 입력창에 적으세요. {openBtn}</span>
          </div>
        </div>
      );
    case "failed":
      return (
        <div className="feed-result warn">
          ⚠️ 실패 — {run.error || "원인은 작업 탭에서"}
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="ghost small feed-btn"
              disabled={!!busy}
              onClick={() => onRetry(run.id)}
            >
              {busy === "retry" ? "⏳…" : "🔁 멈춘 데서 다시 진행"}
            </button>
            <span className="muted small">새 지시로 다시 기획하려면 아래에 적으세요. {openBtn}</span>
          </div>
        </div>
      );
    case "rejected":
      return <div className="feed-result muted">✖ 계획 거절됨 — 새 방향은 아래에 적으세요.</div>;
    case "cancelled":
      return <div className="feed-result muted">⏹ 중단됨 {openBtn}</div>;
    default:
      return null;
  }
}

export function PlanFeed({
  runs,
  onApprove,
  onReject,
  onRevise,
  onGuide,
  onQuickIntervene,
  onRetry,
  onFollowUp,
  onOpenRun,
}: {
  runs: PlanFeedRun[];
  onApprove: (runId: string, editedPlan?: string) => Promise<void> | void;
  onReject: (runId: string) => Promise<void> | void;
  onRevise: (runId: string, feedback: string) => Promise<void> | void;
  onGuide: (runId: string, feedback: string) => Promise<void> | void;
  onQuickIntervene: (runId: string, action: "commit" | "skip" | "abort") => void;
  onRetry: (runId: string) => void;
  onFollowUp: (text: string, parentRunId: string) => Promise<boolean>;
  onOpenRun: (runId: string) => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const last = runs[runs.length - 1];
  const mode = inputModeOf(last);

  // 새 턴이 붙으면 최신이 보이도록 바닥에 붙인다 (대화 UX의 기본 자세).
  const feedKey = useMemo(() => runs.map((r) => `${r.id}:${r.status}:${r.planRevisions.length}`).join("|"), [runs]);
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [feedKey]);

  if (runs.length === 0) return null;

  async function send() {
    const text = input.trim();
    if (!text || busy || mode === "locked" || !last) return;
    setBusy("send");
    try {
      if (mode === "revise") await onRevise(last.id, text);
      else if (mode === "guide") await onGuide(last.id, text);
      else {
        const ok = await onFollowUp(text, last.id);
        if (!ok) return; // 실패 배너는 상위(useWorkspace)가 띄운다 — 입력은 보존
      }
      setInput("");
    } catch {
      // 액션 실패 — 배너는 상위(useWorkspace)가 띄웠고, 입력은 보존.
    } finally {
      setBusy(null);
    }
  }

  const wrap =
    (key: string, fn: () => Promise<void> | void) =>
    async () => {
      setBusy(key);
      try {
        await fn();
      } catch {
        // 실패 배너는 상위(useWorkspace)가 띄운다 — 여기선 busy만 푼다.
      } finally {
        setBusy(null);
      }
    };

  return (
    <div className="panel">
      <b>기획 스레드</b>
      <div className="muted small" style={{ marginTop: 4 }}>
        요청 → 계획 → 승인 → 구현 → 후속… 이 프로젝트의 기획 흐름 전체입니다.
      </div>

      <div className="plan-feed" ref={scrollRef}>
        {runs.map((run) => {
          const revs = run.planRevisions;
          const awaiting = run.status === "awaiting_approval";
          return (
            <div key={run.id} className="feed-run">
              <UserBubble text={run.brief} ts={run.createdAt} />
              {revs.map((rev, i) => {
                const isLast = i === revs.length - 1;
                const label =
                  rev.kind === "initial"
                    ? "계획"
                    : rev.kind === "edit"
                      ? `계획 v${rev.version} (직접 수정)`
                      : `계획 v${rev.version}`;
                return (
                  <div key={rev.id}>
                    {rev.feedback && <UserBubble text={rev.feedback} ts={rev.createdAt} />}
                    <PlanCard
                      run={run}
                      version={rev.version}
                      label={label}
                      ts={rev.createdAt}
                      isLatestOfRun={isLast}
                      awaiting={awaiting && isLast}
                      busy={busy}
                      onApprove={(id, plan) => wrap("approve", () => onApprove(id, plan))()}
                      onReject={(id) => wrap("reject", () => onReject(id))()}
                    />
                  </div>
                );
              })}
              <ResultLine
                run={run}
                busy={busy}
                onQuickIntervene={(id, a) => wrap("intervene", () => onQuickIntervene(id, a))()}
                onRetry={(id) => wrap("retry", () => onRetry(id))()}
                onOpenRun={onOpenRun}
              />
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10 }}>
        <textarea
          rows={3}
          placeholder={
            mode === "locked"
              ? "팀이 작업 중이에요 — 잠시만요"
              : "여기에 적으세요 — 수정 요청·추가 요구·재작업 지시 무엇이든  (Enter 전송 · Shift+Enter 줄바꿈)"
          }
          value={input}
          disabled={mode === "locked" || !!busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="row spread" style={{ marginTop: 6 }}>
          <span className="muted small">↳ {last ? MODE_HINT[mode](last) : ""}</span>
          <button
            type="button"
            className="small"
            disabled={!input.trim() || !!busy || mode === "locked"}
            onClick={send}
          >
            {busy === "send" ? "⏳ 전송 중…" : "보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
