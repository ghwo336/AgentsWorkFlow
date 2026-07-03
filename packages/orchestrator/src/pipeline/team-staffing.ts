import { applyableTeam, describeTeam, rosterOf, SEATS } from "@agent-loop/shared/roster";
import type { RunReporter } from "../reporter.js";
import type { PipelineDeps } from "./types.js";

// 팀 스태핑 정책 — "호재의 추천을 실제 팀으로 만드는 규칙"이 전부 이 모듈이다:
// 추천 정제(applyableTeam: 최소 검증자 강제), 단계 배정에 등장한 개발자 합류,
// 최종 로스터에 없는 배정 무효화. 파이프라인 상태머신은 이 정책의 내용은 모르고
// 결과(정리된 단계 배정)만 받는다.

// The developers the planner may assign steps to (seat catalog for the prompt).
// 수동 선택 run은 선택된 개발자만, 자동 배치 run은 전원(builderIds 생략).
export function assignableDevsFor(
  builderIds?: string[] | null
): Array<{ key: string; name: string; specialty?: string }> {
  return SEATS.filter(
    (s) => s.role === "build" && (builderIds?.includes(s.agentId) ?? true)
  ).map((s) => ({ key: s.key, name: s.name, specialty: s.specialty }));
}

// Apply 호재's staffing to the run and return the sanitized per-step assignees.
// 자동 배치(suggestTeam) run: 추천 팀 + 단계 배정에 등장한 개발자를 합쳐
// Run.agents에 적용한다 (승인 화면에서 함께 확인된다). applyableTeam이 최소
// 검증자(주호·성호)를 강제하고, 추천이 아예 없으면 전원 참여로 안전하게 진행.
export async function applyTeamStaffing(args: {
  deps: PipelineDeps;
  runId: string;
  reporter: RunReporter;
  suggestTeam?: boolean;
  builderIds?: string[]; // 수동 선택 run의 개발자들; 자동 배치면 생략
  planned: { devs: (string | null)[]; team: string[] | null };
}): Promise<(string | null)[]> {
  const { deps, runId, reporter, planned } = args;

  let effectiveBuilders = args.builderIds ?? null; // null = 전원
  if (args.suggestTeam) {
    const assignedSeats = planned.devs
      .filter((d): d is string => !!d)
      .map((id) => SEATS.find((s) => s.role === "build" && s.agentId === id)?.key)
      .filter((k): k is string => !!k);
    const recommended = [...(planned.team ?? []), ...assignedSeats];
    const team = recommended.length > 0 ? applyableTeam(recommended) : null;
    if (team) {
      await deps.store.saveAgents(runId, team);
      effectiveBuilders = rosterOf(team).builderIds;
      await reporter.log("plan", `👥 호재의 팀 배치: ${describeTeam(team)}`);
    } else {
      await reporter.log("plan", "호재가 팀을 특정하지 않아 전원 참여로 진행합니다.", {
        level: "warn",
      });
    }
  }

  // 단계 배정 정리: 최종 로스터에 없는 개발자 배정은 무효(null → 순환 배정).
  return planned.devs.map((d) =>
    d && (effectiveBuilders === null || effectiveBuilders.includes(d)) ? d : null
  );
}
