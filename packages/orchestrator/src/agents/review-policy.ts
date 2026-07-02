// The ONE review rulebook every LLM reviewer follows (codex, claude, and any
// future engine). Keeping the verdict policy in one module means all reviewers
// in the fan-out apply the same bar — strictness on material defects, the
// security mandate, and the convergence rules that stop the whack-a-mole loop.

export const REVIEWER_PROMPT_HEADER = [
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
  "Write the `reason` in KOREAN (한국어). The reason must clearly cover:",
  "  - 무엇을 검토했고 어떤 일이 이루어졌는지 (간단히),",
  "  - FAIL이라면 무엇이 문제라서 거절하는지 (구체적 위치/이유, 보안 문제 포함),",
  "  - PASS라면 보안 점검 결과 문제가 없음을 명시.",
  "Keep code, identifiers, and file paths in their original form.",
];

// Rejection history block: on retries the reviewer's first job is to check the
// previously-flagged defects are fixed — not to find a fresh nitpick each round
// (the whack-a-mole pattern that exhausted every retry on real runs).
export function previousFailuresBlock(attempt?: number, previousFailures?: string[]): string[] {
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

export interface ReviewPromptOpts {
  attempt?: number;
  previousFailures?: string[];
  // Reviewer-specific angle appended to the shared rulebook (e.g. the claude
  // reviewer's runtime/integration lens), so engines complement instead of
  // duplicating each other.
  lens?: string[];
  // How the engine must express its verdict (codex: output schema; claude:
  // a VERDICT line). Appended last so it isn't buried.
  verdictFormat?: string[];
}

export function buildReviewPrompt(plan: string, diff: string, opts: ReviewPromptOpts = {}): string {
  return [
    ...REVIEWER_PROMPT_HEADER,
    ...(opts.lens ?? []),
    "",
    "=== PLAN ===",
    plan,
    ...previousFailuresBlock(opts.attempt, opts.previousFailures),
    "",
    "=== DIFF (uncommitted changes) ===",
    diff || "(no changes)",
    ...(opts.verdictFormat ?? []),
  ].join("\n");
}
