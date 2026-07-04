import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rosterOf } from "@agent-loop/shared/roster";
import {
  FakeGit,
  makeBuilder,
  makeDeps,
  makePlanner,
  makeReporter,
  makeReviewer,
  mkOrder,
  type FakeReporter,
} from "./fakes.js";
import { executeSteps } from "./step-runner.js";

// 호재 에스컬레이션 사다리 (step-runner) — run의 심장. 라운드1(빌더 재시도) →
// 호재(Opus) 개입 → 라운드2 → 여전히 실패면 needs_input. 상태 전이가 계약이라
// 여기 고정해 두면 사다리 로직을 손볼 때 회귀가 잡힌다.
// 실행: npm -w @agent-loop/orchestrator test

const TEAM = ["plan:hojae", "build:taekyung", "verify:seongho"]; // 호재 있음
const NO_LEAD = ["build:taekyung", "verify:seongho"]; // 호재 없음

function run(
  reporter: FakeReporter,
  deps: Parameters<typeof executeSteps>[0],
  steps: string[],
  roster: ReturnType<typeof rosterOf>
) {
  return executeSteps(deps, {
    runId: "run1",
    approvedPlan: "PLAN",
    steps,
    brief: "brief",
    targetDir: "/ws",
    project: "proj",
    reporter,
    order: mkOrder(),
    roster,
    seedParentId: "PLAN_STEP",
    startIdx: 0,
  });
}

describe("executeSteps — 정상 경로", () => {
  it("첫 시도에 통과하면 단계를 커밋하고 run을 committed로 마감한다", async () => {
    const reporter = makeReporter();
    const git = new FakeGit();
    const planner = makePlanner();
    const deps = makeDeps({ git, planner, reviewers: [makeReviewer("빌드", true)] });

    await run(reporter, deps, ["단계1"], rosterOf(TEAM));

    assert.equal(reporter.lastStatus(), "committed");
    assert.equal(git.commits.length, 1, "단계 커밋 1건");
    assert.equal(planner.interveneCount, 0, "통과했으니 호재 개입 없음");
  });

  it("여러 단계가 모두 통과하면 단계마다 커밋한다", async () => {
    const reporter = makeReporter();
    const git = new FakeGit();
    const deps = makeDeps({ git, reviewers: [makeReviewer("빌드", true)] });

    await run(reporter, deps, ["단계1", "단계2", "단계3"], rosterOf(TEAM));

    assert.equal(reporter.lastStatus(), "committed");
    assert.equal(git.commits.length, 3);
  });
});

describe("executeSteps — 에스컬레이션 사다리", () => {
  it("계속 실패하면 호재가 한 번 개입한 뒤 needs_input으로 park한다", async () => {
    const reporter = makeReporter();
    const git = new FakeGit();
    const planner = makePlanner();
    const deps = makeDeps({ git, planner, reviewers: [makeReviewer("빌드", false)] });

    await run(reporter, deps, ["단계1"], rosterOf(TEAM));

    assert.equal(planner.interveneCount, 1, "라운드1 실패 후 호재 개입 정확히 1회");
    assert.equal(reporter.lastStatus(), "needs_input");
    assert.equal(git.commits.length, 0, "통과 못했으니 커밋 없음");
  });

  it("라운드1은 실패하고 라운드2(호재 개입 후)에 통과하면 커밋한다", async () => {
    const reporter = makeReporter();
    const git = new FakeGit();
    const planner = makePlanner();
    // maxVerifyRetries=2 → 라운드1은 검토 2회(모두 실패). 3번째 검토(라운드2
    // 첫 시도)에 통과.
    let calls = 0;
    const deps = makeDeps({
      git,
      planner,
      reviewers: [makeReviewer("빌드", () => ++calls >= 3)],
    });

    await run(reporter, deps, ["단계1"], rosterOf(TEAM));

    assert.equal(planner.interveneCount, 1, "라운드1↔2 사이 호재 개입 1회");
    assert.equal(reporter.lastStatus(), "committed");
    assert.equal(git.commits.length, 1);
  });

  it("호재가 팀에 없으면 라운드1 실패 즉시 needs_input (에스컬레이션 없음)", async () => {
    const reporter = makeReporter();
    const git = new FakeGit();
    const planner = makePlanner();
    const deps = makeDeps({ git, planner, reviewers: [makeReviewer("빌드", false)] });

    await run(reporter, deps, ["단계1"], rosterOf(NO_LEAD));

    assert.equal(planner.interveneCount, 0, "호재 없으면 intervene 호출 안 함");
    assert.equal(reporter.lastStatus(), "needs_input");
    assert.equal(git.commits.length, 0);
  });

  it("빌더가 아무 변경도 안 만들면 검토 없이 재시도 → 결국 needs_input", async () => {
    const reporter = makeReporter();
    const git = new FakeGit(); // 깨끗한 트리
    const planner = makePlanner();
    let reviewCalls = 0;
    const deps = makeDeps({
      git,
      planner,
      builder: makeBuilder(git, { produces: false }), // 아무 변경도 안 만드는 빌더
      reviewers: [makeReviewer("빌드", () => (reviewCalls++, true))],
    });

    await run(reporter, deps, ["단계1"], rosterOf(TEAM));

    assert.equal(reviewCalls, 0, "변경이 없으면 검증자는 아예 호출되지 않는다");
    assert.equal(git.commits.length, 0);
    assert.equal(reporter.lastStatus(), "needs_input");
  });
});

describe("executeSteps — 다단계 실패 지점", () => {
  it("2단계 run에서 1단계는 통과하고 2단계에서 막히면 needs_input 사유가 2/2를 가리킨다", async () => {
    const reporter = makeReporter();
    const git = new FakeGit();
    // 1단계(검토 1회)는 통과, 이후 2단계는 계속 실패.
    let calls = 0;
    const deps = makeDeps({
      git,
      planner: makePlanner(),
      reviewers: [makeReviewer("빌드", () => ++calls === 1)],
    });

    await run(reporter, deps, ["단계1", "단계2"], rosterOf(TEAM));

    assert.equal(reporter.lastStatus(), "needs_input");
    assert.equal(git.commits.length, 1, "1단계만 커밋됨");
    const parked = reporter.statuses.find((s) => s.status === "needs_input");
    assert.match(parked?.error ?? "", /2\/2/, "막힌 단계가 2/2로 표시");
  });
});
