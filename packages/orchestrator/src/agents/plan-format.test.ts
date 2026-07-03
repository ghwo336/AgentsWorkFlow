import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePlanOutput } from "./plan-format.js";

// 플래너 출력 포맷(```steps / ```team)의 파싱 계약. 프롬프트와 파서가 같은
// 모듈에 살지만, 포맷을 손댈 때 회귀는 여기서 잡는다.

describe("parsePlanOutput", () => {
  it("문자열 steps (레거시 형태)", () => {
    const r = parsePlanOutput('계획 본문\n```steps\n["A 구현", "B 연결"]\n```');
    assert.deepEqual(r.steps, ["A 구현", "B 연결"]);
    assert.deepEqual(r.devs, [null, null]);
    assert.equal(r.team, null);
    assert.equal(r.cleanText, "계획 본문");
  });

  it("객체 steps — dev 좌석 키가 person id로 해석", () => {
    const r = parsePlanOutput(
      '본문\n```steps\n[{"desc":"UI","dev":"build:taekyung"},{"desc":"API","dev":"build:minjae"}]\n```'
    );
    assert.deepEqual(r.steps, ["UI", "API"]);
    assert.deepEqual(r.devs, ["taekyung", "minjae"]);
  });

  it("dev가 unknown/검증자 좌석이면 null (순환 배정 폴백)", () => {
    const r = parsePlanOutput(
      '본문\n```steps\n[{"desc":"X","dev":"verify:juho"},{"desc":"Y","dev":"nope"}]\n```'
    );
    assert.deepEqual(r.devs, [null, null]);
  });

  it("team 블록 추출 + 본문에서 제거", () => {
    const r = parsePlanOutput(
      '본문\n```steps\n["A"]\n```\n```team\n["build:juhee","verify:donghwan"]\n```'
    );
    assert.deepEqual(r.team, ["build:juhee", "verify:donghwan"]);
    assert.equal(r.cleanText.includes("```team"), false);
    assert.equal(r.cleanText.includes("```steps"), false);
  });

  it("블록이 없으면 전체 텍스트가 단일 단계 (원샷 빌드로 강등)", () => {
    const r = parsePlanOutput("그냥 계획 텍스트");
    assert.deepEqual(r.steps, ["그냥 계획 텍스트"]);
    assert.deepEqual(r.devs, [null]);
    assert.equal(r.team, null);
  });

  it("깨진 JSON은 단일 단계 폴백 (throw 금지)", () => {
    const r = parsePlanOutput("본문\n```steps\n[not json\n```");
    assert.equal(r.steps.length, 1);
    assert.equal(r.team, null);
  });
});
