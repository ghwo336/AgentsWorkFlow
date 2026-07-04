import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateGrokUsage, parseGrokJson } from "./grok-agent.js";

// Grok CLI 출력 파싱 + 사용량 추정의 계약. CLI는 토큰 수를 주지 않으므로
// 추정 로직이 "그럴듯한 0 아님" 값을 항상 내는지가 핵심이다.

describe("parseGrokJson", () => {
  it("JSON 출력에서 text와 sessionId를 꺼낸다", () => {
    const r = parseGrokJson('{"text":"보고서","sessionId":"abc-123","stopReason":"EndTurn"}');
    assert.equal(r.text, "보고서");
    assert.equal(r.sessionId, "abc-123");
  });

  it("비-JSON 출력은 원문을 답으로, sessionId는 null", () => {
    const r = parseGrokJson("그냥 텍스트 덤프");
    assert.equal(r.text, "그냥 텍스트 덤프");
    assert.equal(r.sessionId, null);
  });
});

describe("estimateGrokUsage", () => {
  it("sessionId가 없으면 문자수 추정 (영문 프롬프트 /4, 한국어 출력 /3)", async () => {
    const u = await estimateGrokUsage({
      cwd: "/nonexistent",
      sessionId: null,
      promptChars: 4000,
      outputChars: 3000,
    });
    assert.equal(u.inputTokens, 1000);
    assert.equal(u.outputTokens, 1000);
  });

  it("세션 파일이 없어도 throw 없이 문자수 폴백", async () => {
    const u = await estimateGrokUsage({
      cwd: "/definitely/not/a/real/cwd",
      sessionId: "no-such-session",
      promptChars: 400,
      outputChars: 300,
    });
    assert.equal(u.inputTokens, 100);
    assert.equal(u.outputTokens, 100);
  });
});
