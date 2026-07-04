import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REVIEWER_AGENT_ID } from "@agent-loop/shared/roster";
import { agentById, agentForChat, agentForEvent, agentForStep, CAST, USER_AGENT } from "./cast";
import type { Step } from "./types";

// 캐릭터 배정은 해시/순환 기반의 "조용히 깨지면 알아채기 어려운" 순수 로직이다 —
// 좌석 매핑이 어긋나면 화면이 엉뚱한 팀원을 그릴 뿐 에러가 없다. 여기서는
// (1) 스탬프 신뢰, (2) 리뷰어 정체성 좌석, (3) 결정성(같은 입력 = 같은 얼굴),
// (4) 레거시 폴백이 CAST 밖으로 새지 않음을 고정한다.

function step(over: Partial<Step>): Step {
  return {
    id: "step-1",
    runId: "run-1",
    parentId: null,
    kind: "build",
    label: "단계 1/3 · 빌드",
    engine: "claude",
    model: "claude-sonnet-4-6",
    agent: null,
    attempt: 1,
    status: "passed",
    summary: null,
    startedAt: "2026-07-04T00:00:00Z",
    endedAt: null,
    orderIdx: 0,
    ...over,
  };
}

describe("agentForStep", () => {
  it("스탬프된 roster id를 그대로 신뢰한다", () => {
    assert.equal(agentForStep(step({ agent: "minjae" })).id, "minjae");
    assert.equal(agentForStep(step({ agent: "yerim", kind: "research" })).id, "yerim");
  });

  it("모르는 스탬프는 레거시 휴리스틱으로 폴백한다 (throw 금지)", () => {
    const a = agentForStep(step({ agent: "no-such-person" }));
    assert.ok(CAST.some((c) => c.id === a.id));
  });

  it("리뷰 스텝은 라벨의 리뷰어 정체성 키로 좌석을 정한다 — roster와 일치", () => {
    for (const [name, agentId] of Object.entries(REVIEWER_AGENT_ID)) {
      const got = agentForStep(step({ kind: "review", label: `리뷰: ${name}`, engine: "codex" }));
      assert.equal(got.id, agentId, `리뷰어 "${name}"의 좌석`);
    }
  });

  it("같은 스텝은 몇 번을 그려도 같은 얼굴이다 (결정성)", () => {
    const s = step({ id: "abc123", attempt: 0 });
    assert.equal(agentForStep(s).id, agentForStep(s).id);
  });

  it("레거시 빌드 스텝(스탬프 없음)은 attempt 순환으로 개발자를 배정한다", () => {
    const builds = [1, 2, 3, 4, 5, 6].map((attempt) => agentForStep(step({ attempt })).id);
    for (const id of builds) assert.equal(agentById(id).role, "build");
    // 순환이므로 attempt N과 N+개발자수는 같은 사람.
    const devCount = CAST.filter((c) => c.role === "build").length;
    assert.equal(builds[0], agentForStep(step({ attempt: 1 + devCount })).id);
  });

  it("commit 스텝은 시스템 캐릭터다", () => {
    assert.equal(agentForStep(step({ kind: "commit", label: "단계 1/3 · 커밋" })).id, "system");
  });
});

describe("agentForChat", () => {
  it("user 턴은 리더(나)", () => {
    assert.equal(agentForChat({ role: "user" }).id, USER_AGENT.id);
  });

  it("verify 턴은 engine에 실린 리뷰어 정체성 키로 좌석을 정한다", () => {
    for (const [name, agentId] of Object.entries(REVIEWER_AGENT_ID)) {
      assert.equal(agentForChat({ role: "verify", engine: name }).id, agentId);
    }
  });

  it("스탬프된 agent id가 있으면 role보다 우선한다", () => {
    assert.equal(agentForChat({ role: "build", agent: "juhee" }).id, "juhee");
  });
});

describe("agentForEvent", () => {
  it("같은 (phase, model)은 항상 같은 얼굴이다", () => {
    const ev = { id: "e1", model: "sonnet", phase: "build" };
    assert.equal(agentForEvent(ev).id, agentForEvent({ ...ev, id: "e2" }).id);
  });

  it("commit phase는 시스템, research phase는 리서처다", () => {
    assert.equal(agentForEvent({ id: "e", model: null, phase: "commit" }).id, "system");
    assert.equal(agentForEvent({ id: "e", model: "grok", phase: "research" }).role, "research");
  });
});
