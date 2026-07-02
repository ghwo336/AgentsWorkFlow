import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexVerdict } from "@agent-loop/shared/types";
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

const REVIEWER_PROMPT_HEADER = [
  "You are a strict code reviewer in an automated dev loop.",
  "Decide whether the DIFF correctly and completely implements the PLAN's CURRENT",
  "STEP and is safe to commit.",
  "",
  "VERDICT POLICY — strict on defects, but CONVERGE (this loop has limited retries):",
  "- FAIL only for MATERIAL defects: the current step's required behavior is broken",
  "  or missing, the change doesn't compile/run, or there is a security issue.",
  "- Report EVERY material defect you can find in THIS single review, ordered by",
  "  severity. Never reveal problems one at a time across attempts — anything you",
  "  don't report now you forfeit the right to fail for later.",
  "- Do NOT FAIL for: style/naming preferences, refactor ideas, micro-optimizations,",
  "  or robustness hardening BEYOND what the plan's current step asks for (ideal DB",
  "  constraints, theoretical race conditions, exhaustive edge cases the plan never",
  "  mentioned). Put those in `reason` prefixed with '제안:' and still PASS.",
  "- A later step in the PLAN may cover a concern (tests, UI, polish) — do not fail",
  "  the current step for work the plan assigns to a later step.",
  "",
  "SECURITY REVIEW IS MANDATORY — you MUST audit the DIFF for security problems on",
  "EVERY review, regardless of what the PLAN asks for. A change that implements the",
  "plan perfectly but introduces a security issue MUST still FAIL. Explicitly check for:",
  "  - Injection (SQL/command/path/template), unsafe eval/deserialization",
  "  - Hardcoded or leaked secrets, credentials, tokens, private keys",
  "  - Missing authentication / authorization or broken access control",
  "  - Unvalidated/untrusted input reaching sensitive sinks (fs, network, shell, DB)",
  "  - Path traversal, SSRF, unsafe file writes, insecure temp files",
  "  - Sensitive data logged or exposed; weak crypto / weak randomness",
  "  - Dependency or supply-chain risks introduced by the change",
  "When you FAIL for a security reason, state the specific vulnerability and location",
  "in the reason. If you find no security issues, say so explicitly in the reason.",
  "",
  "Respond ONLY via the provided output schema as {verdict, reason}.",
  "Write the `reason` field in KOREAN (한국어). The reason must clearly cover:",
  "  - 무엇을 검토했고 어떤 일이 이루어졌는지 (간단히),",
  "  - FAIL이라면 무엇이 문제라서 거절하는지 (구체적 위치/이유, 보안 문제 포함),",
  "  - PASS라면 보안 점검 결과 문제가 없음을 명시.",
  "Keep code, identifiers, and file paths in their original form.",
];

// Rejection history block: on retries the reviewer's first job is to check the
// previously-flagged defects are fixed — not to find a fresh nitpick each round
// (the whack-a-mole pattern that exhausted every retry on real runs).
function previousFailuresBlock(attempt?: number, previousFailures?: string[]): string[] {
  if (!previousFailures?.length) return [];
  const recent = previousFailures.slice(-3).map(
    (f, i) =>
      `--- 이전 거절 ${previousFailures.length - Math.min(3, previousFailures.length) + i + 1} ---\n${f.slice(0, 1500)}`
  );
  return [
    "",
    `=== PREVIOUS REJECTIONS (this is attempt ${attempt ?? previousFailures.length + 1} for this step) ===`,
    "The builder has already been rejected for the reasons below and has attempted fixes.",
    ...recent,
    "",
    "FIRST verify each previously-flagged defect above is actually fixed in the DIFF",
    "(state the result per item in `reason`). If all are fixed and the diff introduces",
    "no NEW material defect, PASS. Surfacing a brand-new minor concern at this stage",
    "instead of converging is a review failure on your part.",
  ];
}

function buildReviewPrompt(
  plan: string,
  diff: string,
  opts: { attempt?: number; previousFailures?: string[] } = {}
): string {
  return [
    ...REVIEWER_PROMPT_HEADER,
    "",
    "=== PLAN ===",
    plan,
    ...previousFailuresBlock(opts.attempt, opts.previousFailures),
    "",
    "=== DIFF (uncommitted changes) ===",
    diff || "(no changes)",
  ].join("\n");
}

// Run codex (read-only sandbox) as a strict reviewer over the supplied diff,
// forcing a structured {verdict, reason} response via --output-schema.
// Auth is the user's ChatGPT subscription (codex login) — no API billing.
async function runCodexVerify(req: VerifyRequest, schemaPath: string): Promise<VerifyResult> {
  const tmp = await mkdtemp(join(tmpdir(), "agentloop-codex-"));
  const lastMsgPath = join(tmp, "verdict.json");
  const prompt = buildReviewPrompt(req.plan, req.diff, {
    attempt: req.attempt,
    previousFailures: req.previousFailures,
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
// (legacy single-verify) and Reviewer (fan-out), so it can be dropped into the
// reviewers array with any others.
export class CodexVerifier implements Verifier, Reviewer {
  readonly name = "codex";
  readonly kind = "review" as const;
  readonly engine = "codex";
  constructor(private readonly schemaPath: string, readonly model: string = "gpt-5.5") {}

  verify(req: VerifyRequest): Promise<VerifyResult> {
    return runCodexVerify(req, this.schemaPath);
  }
  review(req: VerifyRequest): Promise<VerifyResult> {
    return this.verify(req);
  }
}
