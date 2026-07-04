import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { assertAllowedTargetDir, TargetDirError } from "./workspace-path.js";

// targetDir는 워크스페이스 가드가 신뢰하는 "안전한 루트"가 되므로, allowlist
// 검증이 곧 보안 경계다 — 통과/차단 케이스를 여기 고정해 회귀를 잡는다.
// 실행: npm -w @agent-loop/orchestrator test

describe("assertAllowedTargetDir", () => {
  let base: string; // <tmp>/wp-test-XXXX
  let root: string; // 허용 루트
  let outside: string; // 루트 밖 폴더

  before(async () => {
    // macOS의 tmpdir는 /var → /private/var 심링크 — 반환 경로 비교가 어긋나지
    // 않도록 기준 경로를 realpath로 고정한다.
    base = await realpath(await mkdtemp(join(tmpdir(), "wp-test-")));
    root = join(base, "workspaces");
    outside = join(base, "outside");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
  });
  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("루트 바로 아래 경로를 허용한다 (아직 없는 폴더 포함)", async () => {
    const dir = join(root, "proj-a", "not-yet-created");
    assert.equal(await assertAllowedTargetDir(dir, [root]), dir);
  });

  it("루트 자체도 허용한다", async () => {
    assert.equal(await assertAllowedTargetDir(root, [root]), root);
  });

  it("여러 루트 중 하나에만 속해도 허용한다", async () => {
    const dir = join(outside, "repo");
    assert.equal(await assertAllowedTargetDir(dir, [root, outside]), dir);
  });

  it("루트 밖 절대 경로를 차단한다", async () => {
    await assert.rejects(assertAllowedTargetDir(outside, [root]), TargetDirError);
    await assert.rejects(assertAllowedTargetDir("/etc", [root]), TargetDirError);
  });

  it("../ 탈출을 차단한다", async () => {
    await assert.rejects(
      assertAllowedTargetDir(join(root, "..", "outside"), [root]),
      TargetDirError
    );
  });

  it("루트 이름의 접두어만 같은 형제 폴더를 차단한다", async () => {
    const sibling = join(base, "workspaces-evil");
    await mkdir(sibling, { recursive: true });
    await assert.rejects(assertAllowedTargetDir(sibling, [root]), TargetDirError);
  });

  it("루트 안의 심링크가 밖을 가리키면 차단한다", async () => {
    const link = join(root, "escape");
    await symlink(outside, link);
    await assert.rejects(assertAllowedTargetDir(join(link, "x"), [root]), TargetDirError);
  });
});
