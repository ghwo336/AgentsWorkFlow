import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitResearchLessons } from "./research-shared.js";
import { parseReflectOutput } from "./reflector.js";

// 학습 루프의 LLM 출력 파서들 — 모델 출력은 계약을 어길 수 있으므로, 어긋난
// 형식이 항상 "교훈 없음"으로 조용히 수렴하는지가 핵심 검증이다.

describe("parseReflectOutput", () => {
  const VALID = ["taekyung", "minjae"];

  it("json 펜스에서 projectFacts/proposals를 파싱한다", () => {
    const text = [
      "회고 결과입니다.",
      "```json",
      JSON.stringify({
        projectFacts: [{ condition: "이 프로젝트에서", lesson: "pnpm 사용", evidence: "빌드 실패" }],
        proposals: [
          { agentId: "minjae", condition: "API 작업 시", lesson: "zod 검증 먼저", evidence: "2회 지적" },
        ],
      }),
      "```",
    ].join("\n");
    const out = parseReflectOutput(text, VALID);
    assert.equal(out.projectFacts.length, 1);
    assert.equal(out.projectFacts[0].lesson, "pnpm 사용");
    assert.equal(out.proposals.length, 1);
    assert.equal(out.proposals[0].agentId, "minjae");
  });

  it("펜스 없는 맨몸 JSON도 받는다", () => {
    const out = parseReflectOutput(
      `{"projectFacts": [{"condition": "c", "lesson": "l", "evidence": "e"}], "proposals": []}`,
      VALID
    );
    assert.equal(out.projectFacts.length, 1);
  });

  it("로스터에 없는 agentId 제안은 버린다", () => {
    const out = parseReflectOutput(
      `{"projectFacts": [], "proposals": [{"agentId": "../../etc", "condition": "c", "lesson": "l", "evidence": "e"}]}`,
      VALID
    );
    assert.equal(out.proposals.length, 0);
  });

  it("필드가 빠진 교훈은 버린다", () => {
    const out = parseReflectOutput(
      `{"projectFacts": [{"lesson": "조건 없는 교훈"}], "proposals": []}`,
      VALID
    );
    assert.equal(out.projectFacts.length, 0);
  });

  it("깨진 JSON/JSON 아님은 빈 결과로 수렴한다", () => {
    assert.deepEqual(parseReflectOutput("이번 run에서는 배울 게 없었습니다.", VALID), {
      projectFacts: [],
      proposals: [],
    });
    assert.deepEqual(parseReflectOutput("```json\n{broken\n```", VALID), {
      projectFacts: [],
      proposals: [],
    });
  });

  it("과잉 출력은 상한(사실 3·제안 2)으로 자른다", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ condition: `c${i}`, lesson: `l${i}`, evidence: `e${i}` }));
    const out = parseReflectOutput(
      JSON.stringify({
        projectFacts: many(10),
        proposals: many(10).map((l) => ({ ...l, agentId: "minjae" })),
      }),
      VALID
    );
    assert.equal(out.projectFacts.length, 3);
    assert.equal(out.proposals.length, 2);
  });
});

describe("splitResearchLessons", () => {
  it("lessons 펜스를 보고서에서 떼어낸다", () => {
    const text = [
      "# 보고서",
      "본문입니다.",
      "```lessons",
      `[{"condition": "가격 질문일 때", "lesson": "공식 문서 우선", "evidence": "블로그 수치가 낡아 있었음"}]`,
      "```",
    ].join("\n");
    const { report, lessons } = splitResearchLessons(text);
    assert.ok(!report.includes("```lessons"));
    assert.ok(report.includes("본문입니다."));
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0].condition, "가격 질문일 때");
  });

  it("펜스가 없으면 보고서 원문 그대로 + 교훈 없음", () => {
    const { report, lessons } = splitResearchLessons("# 보고서\n본문");
    assert.equal(report, "# 보고서\n본문");
    assert.equal(lessons.length, 0);
  });

  it("펜스 안 JSON이 깨져도 보고서에서는 제거하고 교훈은 없음 처리", () => {
    const { report, lessons } = splitResearchLessons("본문\n```lessons\n[{broken\n```");
    assert.ok(!report.includes("lessons"));
    assert.equal(lessons.length, 0);
  });
});
