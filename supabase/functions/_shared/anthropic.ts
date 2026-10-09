import Anthropic from "npm:@anthropic-ai/sdk@0.132.1";

// The API key lives only in Edge Function secrets (supabase/functions/.env locally).
export const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

export const MODELS = {
  orchestrator: "claude-opus-5-5",
  extractor: "claude-haiku-5-5",
  /** Used when a page fails extraction twice with Haiku. */
  extractorEscalation: "claude-sonnet-5-5",
  categoriser: "claude-sonnet-5-5",
  insights: "claude-opus-5-5",
} as const;

// US$ per million tokens (Haiku's rate applies to prompts up to 100K tokens; single pages are far below).
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** Cache writes cost 1.25x the input rate and cache reads 0.1x. Unknown models are priced as Opus (fail safe). */
export function costUsd(model: string, usage: Usage): number {
  const price = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const tokens =
    usage.input_tokens * price.input +
    (usage.cache_creation_input_tokens ?? 0) * price.input * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * price.input * 0.1 +
    usage.output_tokens * price.output;
  return tokens / 1_000_000;
}
