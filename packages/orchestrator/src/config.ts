import "dotenv/config";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// repo root is two levels up from packages/orchestrator/src
const ROOT = resolve(__dirname, "../../..");

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

export const config = {
  root: ROOT,
  host: process.env.ORCH_HOST ?? "127.0.0.1",
  port: Number(process.env.ORCH_PORT ?? 4000),
  // Kept OUTSIDE the app repo (a sibling under srv) so an agent's workspace has
  // no parent app-repo to wander into — belt-and-braces with the runtime guard.
  workspacesDir: resolve(ROOT, process.env.WORKSPACES_DIR ?? "../agent-workspaces"),
  planModel: process.env.PLAN_MODEL ?? "claude-opus-4-8",
  buildModel: process.env.BUILD_MODEL ?? "claude-sonnet-4-6",
  codexModel: resolveCodexModel(),
  maxVerifyRetries: Number(process.env.MAX_VERIFY_RETRIES ?? 3),
  verdictSchemaPath: resolve(__dirname, "../verdict.schema.json"),
  // Fan-out review policy: "all" = every reviewer must PASS to commit (default),
  // "any" = one PASS is enough. See runner.ts for the injected reviewer set.
  reviewPolicy: (process.env.REVIEW_POLICY === "any" ? "any" : "all") as "all" | "any",
  // Optional test-runner reviewer: a shell command run in the working copy;
  // exit 0 = PASS. Adds a parallel "test" node to the verify fan-out.
  testCmd: process.env.TEST_CMD?.trim() || undefined,
};
