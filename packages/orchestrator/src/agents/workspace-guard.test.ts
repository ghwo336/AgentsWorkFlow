import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bashEscape, isInside } from "./workspace-guard.js";

// Bash guard는 보안 경계 — 어떤 명령이 통과/차단되는지가 계약이다. 케이스를
// 여기 고정해 두면 정규식을 손볼 때 회귀가 테스트에서 잡힌다.
// 실행: npm -w @agent-loop/orchestrator test

const ROOT = "/Users/Shared/srv/agent-workspaces/demo";

const DENIED: Array<[string, string]> = [
  // 상위 디렉터리 탈출
  ["cd ..", "부모 이동"],
  ["cat ../secret", "상대 경로 탈출"],
  ["cp a/../../x .", "경로 중간의 ../.."],
  // 홈 참조
  ["cd ~", "bare ~"],
  ["ls ~/", "~/ 접두"],
  ["echo $HOME", "$HOME"],
  ["cat ${HOME}/.ssh/id_rsa", "${HOME}"],
  // 워크스페이스 밖 절대 경로 (읽기/쓰기/실행 모두)
  ["cat /etc/passwd", "/etc 읽기"],
  ["ls /Users/hoserver", "타 사용자 홈"],
  ["ls /Users/Shared/srv/agent-loop", "형제 저장소"],
  // /tmp는 공유 임시 폴더 = 반출입 사이드채널 — 허용하지 않는다 (리뷰 지적 P1)
  ["cp .env /tmp/x", "/tmp로 반출"],
  ["cat /tmp/some-file", "/tmp에서 반입"],
  ["bash /tmp/script.sh", "/tmp 스크립트 실행"],
  ["touch /private/tmp/x", "/private/tmp 쓰기"],
  ["echo hi > /var/log/x", "/var 쓰기"],
];

const ALLOWED: Array<[string, string]> = [
  // git 관용구는 ..(범위)와 ~(부모 커밋)를 쓴다 — 경로가 아니므로 통과해야 한다
  ["git diff main..HEAD", "git 범위"],
  ["git log HEAD~1", "git 부모 커밋"],
  ["seq 1..5", "숫자 범위"],
  // 도구 실행 경로
  ["npm run build", "PATH 실행"],
  ["npx tsc --noEmit", "PATH 실행"],
  ["node /usr/local/bin/x", "/usr 하위"],
  ["ls /opt/homebrew/bin", "homebrew"],
  ["grep -q x f || echo none > /dev/null", "/dev/null"],
  // URL은 절대 경로가 아니다
  ["curl https://example.com/a/b", "URL"],
  // 워크스페이스 내부 절대 경로
  [`cat ${ROOT}/src/index.ts`, "워크스페이스 내부"],
];

describe("bashEscape", () => {
  for (const [cmd, why] of DENIED) {
    it(`차단: ${cmd} (${why})`, () => {
      assert.notEqual(bashEscape(ROOT, cmd), null, `expected DENY: ${cmd}`);
    });
  }
  for (const [cmd, why] of ALLOWED) {
    it(`허용: ${cmd} (${why})`, () => {
      assert.equal(bashEscape(ROOT, cmd), null, `expected ALLOW: ${cmd}`);
    });
  }
});

describe("isInside", () => {
  it("루트 자신과 하위 경로는 내부", () => {
    assert.equal(isInside(ROOT, ROOT), true);
    assert.equal(isInside(ROOT, `${ROOT}/a/b`), true);
  });
  it("형제/상위 경로는 외부 (접두 문자열 눈속임 포함)", () => {
    assert.equal(isInside(ROOT, "/Users/Shared/srv"), false);
    assert.equal(isInside(ROOT, `${ROOT}-evil/x`), false);
  });
});
