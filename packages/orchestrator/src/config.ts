import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// repo root is two levels up from packages/orchestrator/src
const ROOT = resolve(__dirname, "../../..");

// The launchd/npm-workspace process runs with cwd=packages/orchestrator, so the
// default dotenv load misses the repo-root .env where the shared secrets
// (ORCH_TOKEN 등) live — load it explicitly (existing vars are not overridden).
loadEnv({ path: join(ROOT, ".env") });

// Resolve the model codex will actually use, so its token usage is priced
// against the right rate: explicit env override → ~/.codex/config.toml → default.
function resolveCodexModel(): string {
  if (process.env.CODEX_MODEL) return process.env.CODEX_MODEL;
  try {
    const toml = readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
    const m = toml.match(/^\s*model\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch {
    /* no codex config — fall through */
  }
  return "gpt-5.5";
}

// Kept OUTSIDE the app repo (a sibling under srv) so an agent's workspace has
// no parent app-repo to wander into — belt-and-braces with the runtime guard.
const workspacesDir = resolve(ROOT, process.env.WORKSPACES_DIR ?? "../agent-workspaces");

export const config = {
  root: ROOT,
  host: process.env.ORCH_HOST ?? "127.0.0.1",
  port: Number(process.env.ORCH_PORT ?? 4000),
  workspacesDir,
  // Shared secret for the HTTP API (the dashboard sends it as a Bearer token).
  // Unset = no auth — acceptable ONLY for isolated local dev; production must
  // set ORCH_TOKEN or any local process/webpage can drive the orchestrator.
  apiToken: process.env.ORCH_TOKEN?.trim() || undefined,
  // Where a run may work. An explicit targetDir must resolve inside one of
  // these roots — otherwise the API would be an arbitrary-filesystem grant
  // (the workspace guard trusts the run's root). Mirrors the dashboard's repo
  // picker scan roots so every pickable repo stays a valid target.
  allowedTargetRoots: [
    workspacesDir,
    ...(process.env.REPO_SCAN_ROOTS ?? "/Users/Shared/srv")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => resolve(p)),
  ],
  planModel: process.env.PLAN_MODEL ?? "claude-opus-4-8",
  buildModel: process.env.BUILD_MODEL ?? "claude-sonnet-4-6",
  // 리서처(상현) — 웹 조사 + 보고서 작성. 깊은 종합이 필요해 기본은 Opus.
  researchModel: process.env.RESEARCH_MODEL ?? "claude-opus-4-8",
  // Run 종료 후 회고(팀 학습 노트 교훈 추출) — 요약성 작업이라 기본 Sonnet.
  reflectModel: process.env.REFLECT_MODEL ?? "claude-sonnet-4-6",
  // Grok Build CLI 바이너리 (리서처 상현 — X 실시간 검색). launchd 프로세스의
  // PATH에는 ~/.grok/bin이 없으므로 절대 경로로. 인증: grok login (구독 OAuth).
  grokBin: process.env.GROK_BIN ?? join(homedir(), ".grok", "bin", "grok"),
  codexModel: resolveCodexModel(),
  // Second-opinion LLM reviewer (유준) — runtime/integration lens in the fan-out.
  reviewModel: process.env.REVIEW_MODEL ?? "claude-sonnet-4-6",
  maxVerifyRetries: Number(process.env.MAX_VERIFY_RETRIES ?? 3),
  verdictSchemaPath: resolve(__dirname, "../verdict.schema.json"),
  // Fan-out review policy: "all" = every reviewer must PASS to commit (default),
  // "any" = one PASS is enough. See runner.ts for the injected reviewer set.
  reviewPolicy: (process.env.REVIEW_POLICY === "any" ? "any" : "all") as "all" | "any",
  // Optional test-runner reviewer: a shell command run in the working copy;
  // exit 0 = PASS. Adds a parallel "test" node to the verify fan-out.
  testCmd: process.env.TEST_CMD?.trim() || undefined,
};
