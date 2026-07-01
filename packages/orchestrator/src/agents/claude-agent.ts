import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PhaseReporter } from "../reporter.js";
import type {
  AgentResult,
  BuildRequest,
  Builder,
  PlanRequest,
  Planner,
} from "./types.js";

type ClaudePhase = "plan" | "build";

// Stream a Claude Agent SDK query, forwarding text + tool activity to the run
// timeline (via the reporter), and return the final assistant text.
async function runClaude(
  reporter: PhaseReporter,
  phase: ClaudePhase,
  model: string,
  prompt: string,
  opts: {
    cwd?: string;
    permissionMode: "plan" | "bypassPermissions" | "default" | "acceptEdits";
    systemPrompt?: string;
    disallowedTools?: string[];
  }
): Promise<AgentResult> {
  const label = phase === "plan" ? "opus" : "sonnet";
  let finalText = "";
  let isError = false;

  const response = query({
    prompt,
    options: {
      model,
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      // Required by the SDK to actually bypass prompts in the build phase.
      ...(opts.permissionMode === "bypassPermissions"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      ...(opts.disallowedTools ? { disallowedTools: opts.disallowedTools } : {}),
      ...(opts.systemPrompt
        ? { systemPrompt: { type: "preset", preset: "claude_code", append: opts.systemPrompt } }
        : {}),
    },
  });

  for await (const msg of response as AsyncIterable<any>) {
    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "text" && block.text.trim()) {
          finalText = block.text;
          await reporter.log(phase, block.text.trim(), { model: label });
        } else if (block.type === "tool_use") {
          const summary = summarizeTool(block.name, block.input);
          await reporter.log(phase, `🔧 ${summary}`, { model: label });
        }
      }
    } else if (msg.type === "result") {
      if (msg.subtype !== "success") {
        isError = true;
        await reporter.log(phase, `Claude 실행이 비정상 종료됨: ${msg.subtype}`, {
          level: "error",
          model: label,
        });
      }
      if (typeof msg.result === "string" && msg.result.trim()) {
        finalText = msg.result;
      }
      await recordClaudeUsage(reporter, phase, model, msg);
    }
  }

  return { text: finalText.trim(), isError };
}

// Pull token usage out of the SDK's final `result` message and persist it.
// Prefer per-model breakdown (`modelUsage`) so subagents on other models are
// attributed correctly; fall back to the aggregate `usage` keyed to the
// requested model.
async function recordClaudeUsage(
  reporter: PhaseReporter,
  phase: ClaudePhase,
  model: string,
  msg: any
): Promise<void> {
  const modelUsage = msg?.modelUsage;
  if (modelUsage && typeof modelUsage === "object") {
    for (const [m, u] of Object.entries<any>(modelUsage)) {
      await reporter.usage({
        engine: "claude",
        model: m,
        phase,
        inputTokens: num(u?.inputTokens),
        outputTokens: num(u?.outputTokens),
        cacheRead: num(u?.cacheReadInputTokens),
        cacheWrite: num(u?.cacheCreationInputTokens),
      });
    }
    return;
  }
  const u = msg?.usage;
  if (u && typeof u === "object") {
    await reporter.usage({
      engine: "claude",
      model,
      phase,
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
    });
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function summarizeTool(name: string, input: any): string {
  switch (name) {
    case "Edit":
    case "Write":
      return `${name} ${input?.file_path ?? ""}`;
    case "Bash":
      return `Bash: ${(input?.command ?? "").slice(0, 120)}`;
    case "Read":
      return `Read ${input?.file_path ?? ""}`;
    default:
      return name;
  }
}

const PLAN_SYSTEM = `You are the PLANNING agent in an automated dev loop.
Produce a concrete, step-by-step implementation plan for the request.
Do NOT write code. Output the plan as clear markdown: goal, files to change,
steps, and risks. Be specific enough that a separate builder agent can execute
it without further questions.

CRITICAL: The ENTIRE plan MUST be in your final response message, inline. Do NOT
save the plan to a file, do NOT write it to ~/.claude/plans or anywhere else, and
do NOT just point to a file. The user reviews your message text directly to
approve — if the plan isn't in the message, they see nothing. You may READ the
repository to ground the plan, but never write files.

IMPORTANT: Write the plan prose in Korean (한국어). Keep code, identifiers,
file paths, and commands in their original form — only the explanations,
section headings, and descriptions should be Korean.

At the VERY END of your message, append a machine-readable step list: a fenced
\`\`\`steps block containing a JSON array of strings. Each string is ONE
self-contained implementation step that a builder agent can execute and a
reviewer can verify on its own. Split the work into meaningful units (NOT one
file per step) — aim for 3–8 ordered steps, each building on the previous.
Write each step description in Korean (code/paths/identifiers stay as-is).
Example:

\`\`\`steps
["Prisma 스키마에 X 모델 추가 후 마이그레이션", "API 라우트 /api/x 구현", "대시보드 UI 연결"]
\`\`\``;

const BUILD_SYSTEM = `You are the BUILD agent in an automated dev loop.
Implement the requested work exactly. When a specific STEP is given, implement
ONLY that step — do not start other steps. Make all necessary file edits in the
working directory. Keep changes focused. Do not commit — a separate verifier
and the orchestrator handle verification and committing.

IMPORTANT: Write all of your prose — progress notes and the final summary — in
Korean (한국어). Code, identifiers, and commands stay in their original form.
When done, write a concise Korean summary covering:
  1) 무엇을 했는지 — which files you changed and what each change does.
  2) 이전 검증에서 거절된 적이 있다면(피드백이 주어졌다면), 그 지적을 어떻게
     해결했는지 구체적으로. (피드백이 없었다면 이 항목은 생략.)`;

// Claude planning agent (Opus): produces the approval-gated plan.
export class ClaudePlanner implements Planner {
  constructor(private readonly model: string) {}

  plan(req: PlanRequest, reporter: PhaseReporter): Promise<AgentResult> {
    const prompt =
      req.previousPlan && req.feedback
        ? [
            `# Original request\n${req.brief}`,
            `# 직전에 당신이 제안한 계획\n${req.previousPlan}`,
            `# 사용자 피드백 — 아래 요청을 반영해 계획을 수정하세요\n${req.feedback}`,
            `수정된 전체 계획을 처음부터 다시 제시하세요 (끝에 \`\`\`steps 블록 포함).`,
          ].join("\n\n")
        : req.brief;
    return runClaude(reporter, "plan", this.model, prompt, {
      cwd: req.cwd,
      permissionMode: "plan",
      systemPrompt: PLAN_SYSTEM,
      // The plan must land inline in the response, not in a file — block the
      // write tools so it can't offload the plan to ~/.claude/plans.
      disallowedTools: ["Write", "Edit", "MultiEdit", "NotebookEdit"],
    });
  }
}

// Claude build agent (Sonnet): implements the approved plan, auto-approved.
export class ClaudeBuilder implements Builder {
  constructor(private readonly model: string) {}

  build(req: BuildRequest, reporter: PhaseReporter): Promise<AgentResult> {
    const s = req.step;
    const completedBlock =
      s && s.completed.length
        ? `# 이미 완료된 단계 (커밋됨 — 다시 구현하지 말 것)\n${s.completed
            .map((d, i) => `${i + 1}. ${d}`)
            .join("\n")}`
        : "";
    const currentBlock = s
      ? `# 지금 구현할 단계 (${s.index}/${s.total}) — 오직 이 단계만 구현\n${s.description}`
      : "";
    const closing = s
      ? `이번 단계(${s.index}/${s.total})만 구현하세요. 다른 단계는 건드리지 마세요.`
      : `Implement this now in the working directory.`;

    const prompt = [
      `# Original request\n${req.brief}`,
      `# Approved plan (전체 맥락)\n${req.approvedPlan}`,
      completedBlock,
      currentBlock,
      req.feedback
        ? `# Verifier feedback from the previous attempt (MUST be fixed)\n${req.feedback}`
        : "",
      closing,
    ]
      .filter(Boolean)
      .join("\n\n");

    return runClaude(reporter, "build", this.model, prompt, {
      cwd: req.cwd,
      permissionMode: "bypassPermissions", // dev phase: everything auto-approved
      systemPrompt: BUILD_SYSTEM,
    });
  }
}
