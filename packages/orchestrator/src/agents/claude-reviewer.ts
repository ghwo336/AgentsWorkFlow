import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildReviewPrompt } from "./review-policy.js";
import type { CodexUsage, Reviewer, VerifyRequest, VerifyResult } from "./types.js";

// A second LLM reviewer with a DIFFERENT lens from codex: instead of repeating
// the same static strictness, it asks "would this actually work when run?" —
// wiring between UI and API, handlers actually hooked up, data flowing end to
// end. This is the defect class that shipped past pure static review (e.g. a
// todo app whose add button did nothing).
const RUNTIME_LENS = [
  "",
  "YOUR LENS — runtime & integration (a second reviewer already covers static",
  "plan-compliance in depth, so DON'T duplicate that; complement it):",
  "- Trace the user-visible flow the step implements: does the UI actually call",
  "  the API it needs? Are handlers/routes/props wired, or defined but never used?",
  "- Would this code behave at runtime: missing await/state updates, dead event",
  "  handlers, mismatched request/response shapes between client and server?",
  "- Read neighboring files when needed to confirm the wiring is real.",
];

const VERDICT_FORMAT = [
  "",
  "=== OUTPUT FORMAT (STRICT) ===",
  "Your FINAL message must start with exactly one line:",
  "VERDICT: PASS",
  "or",
  "VERDICT: FAIL",
  "followed by the reason (Korean, per the rules above). No other preamble.",
];

// Claude-backed reviewer for the fan-out. Read-only (plan permission mode +
// writes disallowed); reports usage back through VerifyResult so the pipeline
// attributes cost to its step like every other reviewer.
export class ClaudeReviewer implements Reviewer {
  readonly name = "claude";
  readonly kind = "review" as const;
  readonly engine = "claude";
  constructor(readonly model: string) {}

  async review(req: VerifyRequest): Promise<VerifyResult> {
    const prompt = buildReviewPrompt(req.plan, req.diff, {
      attempt: req.attempt,
      previousFailures: req.previousFailures,
      lens: RUNTIME_LENS,
      verdictFormat: VERDICT_FORMAT,
    });

    let finalText = "";
    let usage: CodexUsage | undefined;
    try {
      const response = query({
        prompt,
        options: {
          model: this.model,
          cwd: req.cwd,
          permissionMode: "plan", // read-only grounding in the workspace
          disallowedTools: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Task", "Bash"],
        },
      });
      for await (const msg of response as AsyncIterable<any>) {
        if (msg.type === "assistant") {
          for (const block of msg.message?.content ?? []) {
            if (block.type === "text" && block.text.trim()) finalText = block.text;
          }
        } else if (msg.type === "result") {
          if (typeof msg.result === "string" && msg.result.trim()) finalText = msg.result;
          const u = msg?.usage;
          if (u && typeof u === "object") {
            usage = {
              inputTokens: num(u.input_tokens),
              outputTokens: num(u.output_tokens),
              cacheRead: num(u.cache_read_input_tokens),
            };
          }
        }
      }
    } catch (err: any) {
      return {
        passed: false,
        reason: `claude 리뷰 실행에 실패했습니다: ${err?.message ?? err}`,
        raw: String(err?.message ?? err),
      };
    }

    const { passed, reason } = parseVerdict(finalText);
    return { passed, reason, raw: finalText, usage };
  }
}

// "VERDICT: PASS|FAIL" first line (tolerate it appearing later in the text).
// An unparseable review counts as FAIL — same contract as codex, where a
// malformed verdict never silently green-lights a commit.
function parseVerdict(text: string): { passed: boolean; reason: string } {
  const m = text.match(/VERDICT:\s*(PASS|FAIL)/i);
  if (!m) {
    return {
      passed: false,
      reason: `리뷰 판정 형식을 파싱하지 못했습니다 (VERDICT 라인 없음). 원문:\n${text.slice(0, 800)}`,
    };
  }
  const reason = text
    .replace(/^[\s\S]*?VERDICT:\s*(PASS|FAIL)\s*/i, "")
    .trim();
  return { passed: m[1].toUpperCase() === "PASS", reason: reason || "(사유 없음)" };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
