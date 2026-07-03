import { query } from "@anthropic-ai/claude-agent-sdk";

// Minimal Claude SDK call for NON-streaming consumers: run the query, return
// the final assistant text (+ token usage). The 4 copies of this for-await loop
// (chat ×2, reviewer, agent) kept drifting — conversational/one-shot callers
// use this; only claude-agent.ts keeps its own loop because it streams every
// block to the run timeline as it arrives.
type QueryOptions = NonNullable<Parameters<typeof query>[0]["options"]>;

export interface FinalTextUsage {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
}

export async function queryFinalText(
  prompt: string,
  options: QueryOptions
): Promise<{ text: string; usage?: FinalTextUsage }> {
  let finalText = "";
  let usage: FinalTextUsage | undefined;
  const response = query({ prompt, options });
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
  return { text: finalText.trim(), usage };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
