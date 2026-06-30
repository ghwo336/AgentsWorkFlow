// Token pricing + API-equivalent cost calculation, shared by the orchestrator
// (records cost at write time) and the dashboard (display only).
//
// Rates are USD per 1,000,000 tokens. Claude rates are the published API
// prices; cache-read ≈ 0.1× input, cache-write ≈ 1.25× input (5-minute TTL).
// Codex runs on a ChatGPT subscription (no API billing) — the gpt-* rates are
// the hypothetical API-rate equivalent so Claude and Codex can be compared on
// the same axis. Edit these as prices change.

export type Engine = "claude" | "codex";

export interface ModelRate {
  input: number; // per 1M uncached input tokens
  output: number; // per 1M output tokens
  cacheRead: number; // per 1M cached (read) input tokens
  cacheWrite: number; // per 1M cache-creation (write) tokens
}

// Per-million-token rates, keyed by exact model id.
export const PRICING: Record<string, ModelRate> = {
  // ── Claude (Anthropic API) ───────────────────────────────────────
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // ── Codex (gpt-*, API-equivalent estimate) ───────────────────────
  "gpt-5.5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gpt-5.1-codex": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gpt-5-codex": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
};

// Fallback rate used when a model id isn't in the table, so cost is never
// silently zero. Conservative mid-tier estimate.
const FALLBACK_RATE: ModelRate = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

export function rateFor(model: string): ModelRate {
  return PRICING[model] ?? FALLBACK_RATE;
}

export function isPriced(model: string): boolean {
  return model in PRICING;
}

export interface TokenCounts {
  inputTokens: number; // uncached input
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}

// USD cost for a set of token counts under a model's rate.
export function costUsd(model: string, t: TokenCounts): number {
  const r = rateFor(model);
  return (
    (t.inputTokens * r.input +
      t.outputTokens * r.output +
      t.cacheRead * r.cacheRead +
      t.cacheWrite * r.cacheWrite) /
    1_000_000
  );
}
