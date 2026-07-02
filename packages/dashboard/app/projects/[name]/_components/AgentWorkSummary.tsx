"use client";

import { useState } from "react";
import { agentForStep, PixelAvatar, ROLE_COLOR } from "../../../lib/agents";
import { Markdown } from "../../../lib/Markdown";
import type { Step } from "../../../lib/types";
import { fmtClock, fmtDur, stepOutcome } from "../_plan-steps";

type SummaryFilter = "all" | "done" | "error";

// Long runs pile up dozens of work summaries; show the newest PAGE_SIZE first
// (what the user actually checks — "지금 무슨 일이 벌어졌나") and reveal older
// ones on demand.
const PAGE_SIZE = 10;

export function AgentWorkSummary({
  steps,
  status,
  plan,
}: {
  steps: Step[];
  status?: string;
  plan?: string;
}) {
  const [filter, setFilter] = useState<SummaryFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const awaitingApproval = status === "awaiting_approval";
  const visible = steps.filter((step) => step.kind !== "commit" || step.summary);

  const doneCount = visible.filter((s) => s.status === "passed").length;
  const errorCount = visible.filter((s) => s.status === "failed").length;
  const matched = visible
    .filter((s) =>
      filter === "done" ? s.status === "passed" : filter === "error" ? s.status === "failed" : true
    )
    .sort((a, b) => b.orderIdx - a.orderIdx); // newest work first
  const shown = matched.slice(0, limit);
  const hiddenCount = matched.length - shown.length;

  const pickFilter = (f: SummaryFilter) => {
    setFilter(f);
    setLimit(PAGE_SIZE); // a new filter starts back at the latest page
  };

  const TABS: { key: SummaryFilter; label: string }[] = [
    { key: "all", label: `전체 ${visible.length}` },
    { key: "done", label: `✅ 구현 ${doneCount}` },
    { key: "error", label: `⚠️ 오류 ${errorCount}` },
  ];

  return (
    <div className="panel">
      <div className="row spread" style={{ marginBottom: 10 }}>
        <b>작업 요약</b>
        <div className="viz-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`viz-tab${filter === t.key ? " active" : ""}`}
              onClick={() => pickFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="muted small">아직 정리할 작업이 없습니다.</div>
      ) : shown.length === 0 ? (
        <div className="muted small">
          {filter === "done" ? "아직 구현 완료된 작업이 없습니다." : "발생한 오류가 없습니다. 🎉"}
        </div>
      ) : (
        <>
          <div className="agent-summary-list">
            {shown.map((step) => (
              <SummaryItem
                key={step.id}
                step={step}
                awaitingApproval={awaitingApproval && step.kind === "plan"}
                // The plan step's stored summary is compacted; show the full plan
                // (markdown) when expanded so 더보기 actually reveals everything.
                fullText={step.kind === "plan" ? plan : undefined}
              />
            ))}
          </div>
          {hiddenCount > 0 && (
            <button
              className="ghost small"
              style={{ marginTop: 10, width: "100%" }}
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
            >
              ▾ 이전 작업 {hiddenCount}개 더보기
            </button>
          )}
        </>
      )}
    </div>
  );
}

// One work-summary card: who did it, the outcome verdict, and the summary body
// (codex review reason / build "무엇을 했는지"), clamped with a 더보기 toggle.
function SummaryItem({
  step,
  awaitingApproval = false,
  fullText,
}: {
  step: Step;
  awaitingApproval?: boolean;
  fullText?: string;
}) {
  const agent = agentForStep(step);
  const outcome = stepOutcome(step, awaitingApproval);
  const [expanded, setExpanded] = useState(false);
  // Prefer the full text (e.g. the whole plan) over the compacted summary, so
  // expanding really shows everything.
  const body =
    fullText?.trim() ||
    step.summary?.trim() ||
    (step.status === "running" ? "진행 중입니다." : "요약이 없습니다.");
  const long = body.length > 180;
  const collapsed = long && !expanded ? `${body.slice(0, 180).trimEnd()}…` : body;
  const bodyLabel =
    step.kind === "build" ? "구현 내용" : step.kind === "plan" ? "계획 요약" : "리뷰 결과";

  return (
    <div className={`agent-summary-item role-${agent.role}`}>
      <div className="row spread agent-summary-head">
        <div className="agent-summary-who">
          <PixelAvatar agent={agent} size={34} active={step.status === "running"} />
          <div>
            <b style={{ color: ROLE_COLOR[agent.role] }}>{agent.name}</b>
            <span className="muted small">
              {" "}
              {agent.roleLabel} · {step.label}
              {step.attempt > 1 ? ` · ${step.attempt}차` : ""}
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <span className={`badge step-${outcome.tone}`} style={{ whiteSpace: "nowrap" }}>
            {outcome.icon} {outcome.label}
          </span>
          {/* Finished → completion time + how long it took; running → start time. */}
          <div className="muted small" style={{ marginTop: 4 }}>
            {step.endedAt
              ? `${fmtClock(step.endedAt)} 완료 · ${fmtDur(
                  new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime()
                )}`
              : `${fmtClock(step.startedAt)} 시작`}
          </div>
        </div>
      </div>
      <div className="agent-summary-body">
        <span className="muted small">{bodyLabel} · </span>
        {/* Collapsed → plain truncated text (never cut markdown mid-syntax);
            expanded → full text rendered as markdown. */}
        {expanded ? <Markdown>{body}</Markdown> : collapsed}
      </div>
      {long && (
        <button
          className="ghost small"
          style={{ marginTop: 6, boxShadow: "none", padding: "2px 8px" }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "접기 ▾" : "더보기 ▸"}
        </button>
      )}
    </div>
  );
}
