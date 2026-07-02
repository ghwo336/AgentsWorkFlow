// The ONE review rulebook every LLM reviewer follows (codex, claude, and any
// future engine). Keeping the verdict policy in one module means all reviewers
// in the fan-out apply the same bar — strictness on material defects and the
// convergence rules that stop the whack-a-mole loop. Each reviewer then adds
// its own LENS (품질/보안/통합) so the fan-out covers different failure classes
// instead of four people re-reading the same thing.

export const REVIEWER_PROMPT_HEADER = [
  "You are a strict code reviewer in an automated dev loop.",
  "Decide whether the DIFF correctly and completely implements the PLAN's CURRENT",
  "STEP and is safe to commit — judged THROUGH YOUR LENS below. Other reviewers",
  "cover the other lenses in parallel; do not duplicate their job.",
  "",
  "VERDICT POLICY — strict on defects, but CONVERGE (this loop has limited retries):",
  "- FAIL only for MATERIAL defects within your lens: the current step's required",
  "  behavior is broken or missing, or your lens finds a serious problem.",
  "- Report EVERY material defect you can find in THIS single review, ordered by",
  "  severity. Never reveal problems one at a time across attempts — anything you",
  "  don't report now you forfeit the right to fail for later.",
  "- Do NOT FAIL for: style/naming preferences, refactor ideas, micro-optimizations,",
  "  or hardening BEYOND what the plan's current step asks for (ideal DB",
  "  constraints, theoretical race conditions, exhaustive edge cases the plan never",
  "  mentioned). Put those in `reason` prefixed with '제안:' and still PASS.",
  "- A later step in the PLAN may cover a concern (tests, UI, polish) — do not fail",
  "  the current step for work the plan assigns to a later step.",
  "",
  "Write the `reason` in KOREAN (한국어). The reason must clearly cover:",
  "  - 무엇을 검토했고 어떤 일이 이루어졌는지 (간단히),",
  "  - FAIL이라면 무엇이 문제라서 거절하는지 (구체적 위치/이유),",
  "  - PASS라면 당신의 렌즈 기준으로 문제가 없음을 명시.",
  "Keep code, identifiers, and file paths in their original form.",
];

// 주호 — 코드 품질/소프트웨어 공학 원칙. Does the change implement the step
// correctly AND leave the codebase structurally sound (SOLID, DRY, cohesion)?
export const QUALITY_LENS = [
  "",
  "YOUR LENS — correctness + software-engineering principles (코드 품질):",
  "- First: does the DIFF correctly and completely implement the PLAN's current",
  "  step? Missing pieces and logic bugs are material defects.",
  "- Then judge the code's engineering quality, FAILing only when the violation is",
  "  MATERIAL (it will actively hurt the next steps or maintenance):",
  "  * SRP: god-functions/files doing many unrelated jobs the step could separate",
  "  * DRY: the diff COPY-PASTES logic that already exists in the repo",
  "  * layering: UI reaching into DB directly when the project has a data layer,",
  "    circular imports, abstractions bypassed",
  "  * dead code, unused exports, misleading names that will confuse the next step",
  "- Minor structure/style improvements are '제안:' + PASS, per the verdict policy.",
];

// 동환 — 보안 전담. The one reviewer whose FAIL is always about security.
export const SECURITY_LENS = [
  "",
  "YOUR LENS — security (보안). Audit the DIFF for vulnerabilities on EVERY review,",
  "regardless of what the PLAN asks for. A change that implements the plan",
  "perfectly but introduces a security issue MUST FAIL. Explicitly check for:",
  "  - Injection (SQL/command/path/template), unsafe eval/deserialization",
  "  - Hardcoded or leaked secrets, credentials, tokens, private keys",
  "  - Missing authentication / authorization or broken access control",
  "  - Unvalidated/untrusted input reaching sensitive sinks (fs, network, shell, DB)",
  "  - Path traversal, SSRF, unsafe file writes, insecure temp files",
  "  - Sensitive data logged or exposed; weak crypto / weak randomness",
  "  - Dependency or supply-chain risks introduced by the change",
  "  - Resource-exhaustion a remote user can trigger (unbounded queries/loops)",
  "When you FAIL, state the specific vulnerability and location. When you PASS,",
  "say explicitly that the security audit found no issues. Correctness/quality",
  "concerns outside security belong to other reviewers — mention at most as '제안:'.",
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
    "FIRST verify each previously-flagged defect above that falls under YOUR lens is",
    "actually fixed in the DIFF (state the result per item in `reason`). If all are",
    "fixed and the diff introduces no NEW material defect, PASS. Surfacing a",
    "brand-new minor concern at this stage instead of converging is a review failure.",
  ];
}

export interface ReviewPromptOpts {
  attempt?: number;
  previousFailures?: string[];
  // Reviewer-specific angle appended to the shared rulebook (QUALITY_LENS,
  // SECURITY_LENS, the claude reviewer's runtime lens, …).
  lens?: string[];
  // How the engine must express its verdict (codex: output schema; claude:
  // a VERDICT line). Appended last so it isn't buried.
  verdictFormat?: string[];
}

// Hard cap on the diff embedded in the prompt. A runaway diff (a scaffold that
// staged node_modules was 37MB) kills every engine at once — codex via the OS
// arg limit, claude via "Prompt is too long". Reviewers run inside the
// workspace and can read files directly, so a truncated diff degrades to
// "read the rest yourself" instead of an infra crash.
const DIFF_PROMPT_CAP = 120_000;

export function buildReviewPrompt(plan: string, diff: string, opts: ReviewPromptOpts = {}): string {
  const shownDiff =
    diff.length > DIFF_PROMPT_CAP
      ? `${diff.slice(0, DIFF_PROMPT_CAP)}\n\n[... diff가 너무 커서 잘렸습니다 (전체 ${diff.length.toLocaleString()}자 중 ${DIFF_PROMPT_CAP.toLocaleString()}자 표시). 나머지 변경은 작업 디렉터리에서 git diff --cached 로 직접 확인하세요.]`
      : diff;
  return [
    ...REVIEWER_PROMPT_HEADER,
    ...(opts.lens ?? []),
    "",
    "=== PLAN ===",
    plan,
    ...previousFailuresBlock(opts.attempt, opts.previousFailures),
    "",
    "=== DIFF (uncommitted changes) ===",
    shownDiff || "(no changes)",
    ...(opts.verdictFormat ?? []),
  ].join("\n");
}
