import { query, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { agentEnv } from "./gate-env.js";
import type { PhaseReporter } from "../reporter.js";
import type { AgentResult } from "./types.js";

// Claude Agent SDK transport for the STREAMING personas (planner/builder/
// researcher — claude-agent.ts, claude-researcher.ts): run a query, forward
// text + tool activity to the run timeline as it arrives, record token usage,
// and return the final assistant text. One-shot callers use claude-query.ts.

export type ClaudePhase = "plan" | "build" | "research";

// Timeline display tag for a log line's speaker — derived from the model id so
// the transport doesn't hardcode which phase runs on which model.
function displayLabel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("opus")) return "opus";
  return model;
}

export async function runClaude(
  reporter: PhaseReporter,
  phase: ClaudePhase,
  model: string,
  prompt: string,
  opts: {
    cwd?: string;
    permissionMode: "plan" | "bypassPermissions" | "default" | "acceptEdits";
    systemPrompt?: string;
    disallowedTools?: string[];
    canUseTool?: CanUseTool;
  }
): Promise<AgentResult> {
  const label = displayLabel(model);
  let finalText = "";
  let isError = false;

  const response = query({
    prompt,
    options: {
      model,
      cwd: opts.cwd,
      // The subprocess must never see the orchestrator's own secrets — the
      // agent runs model-controlled work (gate-env.ts agentEnv).
      env: agentEnv(),
      permissionMode: opts.permissionMode,
      // Required by the SDK to actually bypass prompts in the build phase.
      ...(opts.permissionMode === "bypassPermissions"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      ...(opts.canUseTool ? { canUseTool: opts.canUseTool } : {}),
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
    case "WebSearch":
      return `웹 검색: ${(input?.query ?? "").slice(0, 120)}`;
    case "WebFetch":
      return `웹 페이지 읽기: ${(input?.url ?? "").slice(0, 160)}`;
    default:
      return name;
  }
}
