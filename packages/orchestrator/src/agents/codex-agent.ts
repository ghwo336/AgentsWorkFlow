import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexVerdict } from "@agent-loop/shared/types";
import { buildReviewPrompt } from "./review-policy.js";
import type { CodexUsage, Reviewer, VerifyRequest, VerifyResult, Verifier } from "./types.js";

// Run codex with its STDIN CLOSED. codex reads stdin whenever it's an open pipe
// ("Reading additional input from stdin...") and blocks forever waiting for
// EOF — and Node's execFile leaves the child stdin open, which hangs every
// verification until timeout. Spawning with stdin='ignore' gives an immediate
// EOF (equivalent to `codex … < /dev/null`), so it uses the prompt argument.
function runCodex(
  args: string[],
  opts: { cwd: string; timeoutMs: number; maxBuffer: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () =>
        settle(() => {
          child.kill("SIGKILL");
          reject(Object.assign(new Error("codex timed out"), { stdout, stderr }));
        }),
      opts.timeoutMs
    );
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.length > opts.maxBuffer)
        settle(() => {
          child.kill("SIGKILL");
          reject(Object.assign(new Error("codex output exceeded maxBuffer"), { stdout, stderr }));
        });
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => settle(() => reject(err)));
    child.on("close", (code) =>
      settle(() =>
        code === 0
          ? resolve({ stdout, stderr })
          : reject(Object.assign(new Error(`codex exited with code ${code}`), { stdout, stderr }))
      )
    );
  });
}

// Verdict-format contract for --output-schema (shared rulebook lives in
// review-policy.ts so every LLM reviewer applies the same bar).
const CODEX_VERDICT_FORMAT = [
  "",
  "Respond ONLY via the provided output schema as {verdict, reason}.",
];

// Run codex (read-only sandbox) as a strict reviewer over the supplied diff,
// forcing a structured {verdict, reason} response via --output-schema.
// Auth is the user's ChatGPT subscription (codex login) — no API billing.
async function runCodexVerify(
  req: VerifyRequest,
  schemaPath: string,
  lens?: string[]
): Promise<VerifyResult> {
  const tmp = await mkdtemp(join(tmpdir(), "agentloop-codex-"));
  const lastMsgPath = join(tmp, "verdict.json");
  const prompt = buildReviewPrompt(req.plan, req.diff, {
    attempt: req.attempt,
    previousFailures: req.previousFailures,
    lens,
    verdictFormat: CODEX_VERDICT_FORMAT,
  });

  try {
    const { stdout, stderr } = await runCodex(
      [
        "exec",
        "--json",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        lastMsgPath,
        prompt,
      ],
      { cwd: req.cwd, maxBuffer: 64 * 1024 * 1024, timeoutMs: 15 * 60 * 1000 }
    );

    const usage = parseCodexUsage(stdout);
    // With --json the verdict is in the last-message file; stdout is JSONL.
    const raw = await readFile(lastMsgPath, "utf8").catch(() => stdout || stderr);
    const parsed = extractVerdict(raw);
    return {
      passed: parsed.verdict === "PASS",
      reason: parsed.reason,
      raw,
      usage,
    };
  } catch (err: any) {
    // codex exited non-zero or timed out: treat as a FAIL we can surface.
    const raw = await readFile(lastMsgPath, "utf8").catch(() => "");
    if (raw) {
      try {
        const parsed = extractVerdict(raw);
        return { passed: parsed.verdict === "PASS", reason: parsed.reason, raw };
      } catch {
        /* fall through */
      }
    }
    return {
      passed: false,
      reason: `codex verification failed to run: ${err?.message ?? err}`,
      raw: String(err?.stderr ?? err?.message ?? err),
    };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// Sum token usage across all `turn.completed` events in codex's JSONL stream.
// Codex reports `input_tokens` as the *total* input (including the cached
// portion), so uncached input = input_tokens - cached_input_tokens.
function parseCodexUsage(stdout: string): CodexUsage | undefined {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let found = false;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const ev = JSON.parse(trimmed);
      if (ev?.type === "turn.completed" && ev.usage) {
        found = true;
        const totalIn = Number(ev.usage.input_tokens ?? 0);
        const cached = Number(ev.usage.cached_input_tokens ?? 0);
        input += Math.max(0, totalIn - cached);
        cacheRead += cached;
        output += Number(ev.usage.output_tokens ?? 0);
      }
    } catch {
      /* not a JSON line */
    }
  }
  if (!found) return undefined;
  return { inputTokens: input, outputTokens: output, cacheRead };
}

function extractVerdict(raw: string): CodexVerdict {
  // The last message should be pure JSON (forced by --output-schema), but be
  // defensive: pull the first {...} block out if there's surrounding text.
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) candidates.push(match[0]);

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && (obj.verdict === "PASS" || obj.verdict === "FAIL")) {
        return { verdict: obj.verdict, reason: String(obj.reason ?? "") };
      }
    } catch {
      /* try next */
    }
  }
  throw new Error(`Could not parse codex verdict from: ${trimmed.slice(0, 500)}`);
}

// codex-backed reviewer. The verdict schema path is injected so this module
// stays free of orchestrator config wiring (DIP). It satisfies both Verifier
// (legacy single-verify) and Reviewer (fan-out). One class, many identities:
// the composition root instantiates it once per LENS (품질 리뷰어 주호, 보안
// 리뷰어 동환) — same engine, different job description.
export class CodexVerifier implements Verifier, Reviewer {
  readonly kind = "review" as const;
  readonly engine = "codex";
  readonly name: string;
  private readonly lens?: string[];

  constructor(
    private readonly schemaPath: string,
    readonly model: string = "gpt-5.5",
    identity: { name: string; lens?: string[] } = { name: "codex" }
  ) {
    this.name = identity.name;
    this.lens = identity.lens;
  }

  verify(req: VerifyRequest): Promise<VerifyResult> {
    return runCodexVerify(req, this.schemaPath, this.lens);
  }
  review(req: VerifyRequest): Promise<VerifyResult> {
    return this.verify(req);
  }
}
