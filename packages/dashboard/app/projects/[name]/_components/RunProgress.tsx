"use client";

import {
  agentById,
  agentForStep,
  parseAgents,
  PixelAvatar,
  ROLE_COLOR,
  rosterOf,
  type Agent,
} from "../../../lib/agents";
import type { RunDetail, Step } from "../../../lib/types";
import {
  FLOW_ICON,
  flowVerb,
  groupByPlanStep,
  planRowAgent,
  planRowState,
  planStepDescriptions,
  planStepTotal,
  toneFor,
  type StepGroup,
} from "../_plan-steps";

// Run progress, told as the plan itself unfolds: 기획(호재) produces a plan that
// decomposes into N steps, and each step runs its own 구현→검증→(재시도)→커밋 loop.
// So instead of a fixed pipeline we render the plan step first, then one row per
// plan step showing that loop with the agent behind each action.

// The 단계별 roadmap as a table: every plan step as a row (작업 내용 · 담당 · 상태),
// visible from approval onward. The active step expands to show its live
// 구현→검증→커밋 loop inline.
function PlanStepTable({
  descriptions,
  groups,
  total,
  needsInput = false,
  fallbackBuilder,
}: {
  descriptions: string[];
  groups: StepGroup[];
  total: number;
  needsInput?: boolean;
  fallbackBuilder?: Agent;
}) {
  const groupByNo = new Map(groups.map((g) => [g.no, g]));
  const count = Math.max(descriptions.length, total, groups.length);
  const rows = Array.from({ length: count }, (_, i) => i + 1);
  const doneCount = rows.filter((no) => planRowState(groupByNo.get(no)).tone === "passed").length;

  return (
    <div className="plan-table" style={{ marginTop: 12 }}>
      <div className="plan-table-caption">
        <b>단계별 작업</b>
        <span className="muted small">
          {doneCount}/{count} 완료
        </span>
      </div>
      <div className="plan-thead">
        <span>#</span>
        <span>작업 내용</span>
        <span>담당</span>
        <span>상태</span>
      </div>
      {rows.map((no) => {
        const group = groupByNo.get(no);
        let st = planRowState(group);
        // While parked at needs_input, the stuck step is the one with failed
        // work and no commit — surface it as "개입 대기", not "재시도 중".
        if (needsInput && st.tone === "failed") {
          st = { icon: "🚧", label: "개입 대기", tone: "failed" };
        }
        const agent = planRowAgent(group, fallbackBuilder);
        const desc = descriptions[no - 1] ?? `단계 ${no}`;
        const showFlow = !!group && st.tone !== "pending";
        return (
          <div key={no} className={`plan-trow plan-${st.tone}`}>
            <span className="plan-no">{no}</span>
            <span className="plan-desc">
              {desc}
              {showFlow && group && (
                <span className="plan-subflow">
                  {group.steps.map((s, i) => (
                    <span key={s.id} className="flow-item">
                      {i > 0 && <span className="flow-arrow">→</span>}
                      <FlowPill step={s} />
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="plan-who">
              <PixelAvatar agent={agent} size={20} active={st.tone === "running"} />
              <span style={{ color: ROLE_COLOR[agent.role] }}>{agent.name}</span>
            </span>
            <span className="plan-status">
              <span className={`badge step-${st.tone}`}>
                {st.icon} {st.label}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// One action in a plan step's loop: the icon, who did it, retry number, and a
// pass/fail/running mark.
function FlowPill({ step }: { step: Step }) {
  const agent = agentForStep(step);
  const tone = toneFor(step.status);
  const mark =
    step.status === "passed"
      ? "✓"
      : step.status === "failed"
        ? "✕"
        : step.status === "running"
          ? "…"
          : "•";
  return (
    <span className={`flow-pill flow-${tone}`} title={step.summary ?? step.label}>
      <span className="flow-ico">{FLOW_ICON[step.kind] ?? "•"}</span>
      <span className={step.status === "running" ? "blink" : undefined} style={{ display: "inline-flex" }}>
        <PixelAvatar agent={agent} size={18} active={step.status === "running"} />
      </span>
      <span className="flow-verb">
        {flowVerb(step.kind)}
        {step.attempt > 1 ? ` ${step.attempt}차` : ""} · {agent.name}
      </span>
      <span className="flow-mark">{mark}</span>
    </span>
  );
}

export function RunProgress({ detail }: { detail: RunDetail }) {
  // 이 run의 참여 로스터(좌석) — 조합이 표시할 구간(기획/단계/감사)을 결정한다.
  const roster = rosterOf(parseAgents(detail.agents));
  const hasPlanner = roster.planner;
  const auditOnly = !hasPlanner && roster.builderIds.length === 0; // 검증 전용
  const firstBuilder = roster.builderIds[0] ? agentById(roster.builderIds[0]) : undefined;

  const planStep = detail.steps.find((s) => s.kind === "plan") ?? null;
  const groups = groupByPlanStep(detail.steps);
  const descriptions = planStepDescriptions(detail);
  const total = planStepTotal(detail.steps) || descriptions.length;
  const awaiting = detail.status === "awaiting_approval";
  const building = detail.status === "building" || detail.status === "verifying";
  const planDone = !!planStep && planStep.status === "passed";
  const planFailed = planStep?.status === "failed";
  // 호재 is actively thinking whenever the plan step is running (or the run is
  // spinning up before the step even lands). This is the long, silent stretch
  // that felt "frozen" — so make him visibly work (fire + blink), not idle grey.
  const planRunning = hasPlanner && !awaiting && !planDone && !planFailed;
  const hojae = agentById("hojae");

  // 검증 전용 run: 단계 로드맵 대신 감사 리뷰 스텝들을 그대로 보여준다.
  const auditSteps = auditOnly
    ? detail.steps.filter((s) => s.kind === "review" || s.kind === "test" || s.kind === "verify")
    : [];

  const planBadge = awaiting
    ? { icon: "⏳", label: "승인 대기", tone: "running" }
    : planDone
      ? { icon: "✅", label: "완료", tone: "passed" }
      : planFailed
        ? { icon: "✕", label: "실패", tone: "failed" }
        : { icon: "⏳", label: "기획하는 중…", tone: "running" };

  return (
    <div className="panel">
      <b>진행도</b>

      {/* 기획 — the plan gate lives here; 호재 blinks while awaiting approval.
          호재가 팀에 없으면 이 구간 자체가 없다. */}
      {hasPlanner && (
      <div className="flow-group" style={{ marginTop: 10 }}>
        <div className="flow-group-head">
          <b>기획</b>
          <span className={`badge step-${planBadge.tone}`}>
            {planBadge.icon} {planBadge.label}
          </span>
        </div>
        <div className="flow-line">
          <span
            className={`flow-pill flow-${awaiting || planRunning ? "running" : planDone ? "passed" : "failed"}`}
          >
            <span className="flow-ico">📋</span>
            <span className={awaiting ? "blink" : undefined} style={{ display: "inline-flex" }}>
              {/* on fire while thinking, blinking while waiting for you */}
              <PixelAvatar agent={hojae} size={18} active={planRunning} />
            </span>
            <span className="flow-verb">기획 · {hojae.name}</span>
          </span>
        </div>
      </div>
      )}

      {/* 검증 전용 run — 감사에 참여한 검증자들의 리뷰를 그대로 나열. */}
      {auditOnly && (
        <div className="flow-group" style={{ marginTop: 10 }}>
          <div className="flow-group-head">
            <b>프로젝트 감사</b>
            <span
              className={`badge step-${
                detail.status === "committed"
                  ? "passed"
                  : detail.status === "failed"
                    ? "failed"
                    : "running"
              }`}
            >
              {detail.status === "committed"
                ? "✅ 통과"
                : detail.status === "failed"
                  ? "❌ 문제 발견"
                  : "⏳ 감사 중"}
            </span>
          </div>
          <div className="flow-line">
            {auditSteps.length === 0 ? (
              <span className="muted small">검증자들이 프로젝트를 살펴보는 중…</span>
            ) : (
              auditSteps.map((s) => <FlowPill key={s.id} step={s} />)
            )}
          </div>
        </div>
      )}

      {planRunning && (
        <div className="muted small planning-live" style={{ margin: "10px 0 2px", textAlign: "center" }}>
          <span className="planning-dots" aria-hidden />
          호재가 요구사항을 뜯어보며{" "}
          <b style={{ color: "var(--yellow)" }}>계획을 세우는 중</b>이에요 — 30초~1분 정도 걸릴 수 있어요.
        </div>
      )}

      {awaiting && (
        <div className="muted small" style={{ margin: "10px 0 2px", textAlign: "center" }}>
          호재가 계획을 마치고{" "}
          <b style={{ color: "var(--yellow)" }}>승인을 기다리고 있어요</b> — 위에서 승인하거나 거절하세요.
        </div>
      )}

      {/* 단계별 작업 — the whole roadmap as a table, from approval onward. */}
      {!auditOnly && (descriptions.length > 0 || groups.length > 0) && (
        <PlanStepTable
          descriptions={descriptions}
          groups={groups}
          total={total}
          needsInput={detail.status === "needs_input"}
          fallbackBuilder={firstBuilder}
        />
      )}

      {/* Approval → first build span: the table already lists every step as 대기,
          so just note that work is kicking off. (기획 생략 run은 승인 없이 바로.) */}
      {!auditOnly && groups.length === 0 && (planDone || !hasPlanner) && !awaiting && building && (
        <div className="muted small planning-live" style={{ marginTop: 10, textAlign: "center" }}>
          <span className="planning-dots" aria-hidden />
          {firstBuilder?.name ?? "개발자"}가 1단계 구현을 준비하는 중…
        </div>
      )}
    </div>
  );
}
