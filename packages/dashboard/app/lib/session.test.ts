import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, verifySessionToken, SESSION_MAX_AGE_S } from "./session";

test("발급한 토큰은 같은 시크릿으로 검증된다", async () => {
  const t = await createSessionToken("pw");
  assert.equal(await verifySessionToken(t, "pw"), true);
});

test("다른 시크릿(비밀번호 회전)이면 기존 세션이 무효화된다", async () => {
  const t = await createSessionToken("old-pw");
  assert.equal(await verifySessionToken(t, "new-pw"), false);
});

test("만료된 토큰은 거부된다", async () => {
  const issued = Date.now() - (SESSION_MAX_AGE_S + 1) * 1000;
  const t = await createSessionToken("pw", issued);
  assert.equal(await verifySessionToken(t, "pw"), false);
});

test("만료시각을 앞으로 조작하면 서명이 깨져 거부된다", async () => {
  const t = await createSessionToken("pw");
  const [, sig] = t.split(".");
  const forged = `${Date.now() + 10 ** 9}.${sig}`;
  assert.equal(await verifySessionToken(forged, "pw"), false);
});

test("빈/기형 토큰은 조용히 거부된다", async () => {
  for (const bad of [undefined, "", ".", "abc", "123.", ".sig"]) {
    assert.equal(await verifySessionToken(bad as string | undefined, "pw"), false);
  }
});
