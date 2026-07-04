import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { InterventionDecision } from "@agent-loop/shared/types";
import {
  FakeGit,
  makeDeps,
  makeReporter,
  makeResumeState,
  makeReviewer,
  makeStore,
  type FakeReporter,
} from "./fakes.js";
import { resumeFromInput } from "./intervention.js";
import type { PipelineDeps } from "./types.js";

// needs_input 재개 (intervention) — 사용자가 막힌 단계에 내린 결정(guide/commit/
// skip/abort)에 따라 어디서 이어갈지 계산하는 로직. 재개 지점(stuckIdx)이
// 어긋나면 단계를 건너뛰거나 되풀이하므로, DB에서 파생되는 committedCount →
// 이어질 단계 매핑을 여기 고정한다. 실행: npm -w @agent-loop/orchestrator test

// 3단계 계획에서 committedCount건이 이미 커밋됐다고 보고 재개시키는 헬퍼.
function resume(
  decision: InterventionDecision,
  opts: { committedCount: number; hasChanges?: boolean; steps?: string[] }
): { reporter: FakeReporter; git: FakeGit; deps: PipelineDeps; done: Promise<void> } {
  const reporter = makeReporter();
  // dirty = 막힌 단계가 남긴 (거절된) 커밋 안 된 diff가 있는지.
  const git = new FakeGit({ dirty: opts.hasChanges ?? true });
  const steps = opts.steps ?? ["단계1", "단계2", "단계3"];
  const deps = makeDeps({
    git,
    reviewers: [makeReviewer("빌드", true)], // 재개 후 이어지는 단계는 통과시킨다
    store: makeStore({
      resume: makeResumeState({ steps }),
      resumePoint: {
        committedCount: opts.committedCount,
        lastCommitStepId: opts.committedCount > 0 ? "COMMIT_PREV" : null,
      },
    }),
  });
  return { reporter, git, deps, done: resumeFromInput(deps, "run1", reporter, decision) };
}

describe("resumeFromInput — abort", () => {
  it("작업을 rejected로 마감하고 아무 단계도 실행하지 않는다", async () => {
    const { reporter, git, done } = resume({ action: "abort" }, { committedCount: 1 });
    await done;
    assert.equal(reporter.lastStatus(), "rejected");
    assert.equal(git.commits.length, 0);
    assert.equal(reporter.hasStatus("building"), false, "abort는 빌드로 진입하지 않는다");
  });
});

describe("resumeFromInput — guide (막힌 단계 재실행)", () => {
  it("committedCount=1이면 2단계(stuckIdx=1)부터 재개해 2·3단계를 커밋한다", async () => {
    const { reporter, git, done } = resume(
      { action: "guide", feedback: "이렇게 고치세요" },
      { committedCount: 1 }
    );
    await done;
    assert.equal(reporter.lastStatus(), "committed");
    // 0부터 시작했다면 3커밋. 2커밋이면 stuckIdx=1(막힌 단계)에서 재개했다는 증거.
    assert.equal(git.commits.length, 2);
    const guide = reporter.chats.find((c) => c.kind === "guide");
    assert.ok(guide, "사용자 지침이 팀 채팅에 남는다");
    assert.match(guide!.text, /이렇게 고치세요/);
  });

  it("committedCount가 단계 수를 넘으면 마지막 단계로 clamp한다", async () => {
    // committedCount=5, steps=3 → stuckIdx=min(5,2)=2 (마지막 단계만 재개).
    const { reporter, git, done } = resume(
      { action: "guide", feedback: "고쳐주세요" },
      { committedCount: 5 }
    );
    await done;
    assert.equal(reporter.lastStatus(), "committed");
    assert.equal(git.commits.length, 1, "마지막 단계 하나만 재실행");
  });
});

describe("resumeFromInput — commit (거절된 diff 수용)", () => {
  it("막힌 단계를 사용자 승인으로 커밋하고 다음 단계로 진행한다", async () => {
    const { reporter, git, done } = resume(
      { action: "commit" },
      { committedCount: 1, hasChanges: true }
    );
    await done;
    assert.equal(reporter.lastStatus(), "committed");
    // 사용자 승인 커밋(2단계) + 검증 통과 커밋(3단계) = 2.
    assert.equal(git.commits.length, 2);
    assert.ok(
      git.commits.some((m) => m.includes("사용자 승인")),
      "막힌 단계는 사용자 승인 커밋으로 남는다"
    );
  });

  it("수용할 변경이 없으면 커밋 없이 skipped 처리하고 다음 단계로 넘어간다", async () => {
    const { reporter, git, done } = resume(
      { action: "commit" },
      { committedCount: 1, hasChanges: false }
    );
    await done;
    assert.equal(reporter.lastStatus(), "committed");
    // 변경이 없어 사용자 승인 커밋은 없고, 3단계 커밋만 1건.
    assert.equal(git.commits.length, 1);
    assert.ok(
      reporter.steps.some((s) => s.status === "skipped"),
      "변경 없는 막힌 단계는 skipped 스텝으로 마감"
    );
  });
});

describe("resumeFromInput — skip (막힌 단계 폐기)", () => {
  it("막힌 단계의 변경을 버리고 다음 단계만 커밋한다", async () => {
    const { reporter, git, done } = resume({ action: "skip" }, { committedCount: 1 });
    await done;
    assert.equal(reporter.lastStatus(), "committed");
    assert.equal(git.discarded, 1, "막힌 단계 변경을 discardChanges로 폐기");
    assert.equal(git.commits.length, 1, "다음(3)단계만 커밋");
    assert.ok(reporter.steps.some((s) => s.status === "skipped"));
  });
});
