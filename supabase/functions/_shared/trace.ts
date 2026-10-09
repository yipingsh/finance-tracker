// The live agent trace: every step of a run is streamed to the browser as one JSON line
// (NDJSON). Nothing is stored server-side; the browser keeps the trace with its own data.
//
// Trace messages describe what an agent did (pages, counts, check results), never the
// statement's contents.

import { costUsd, type Usage } from "./anthropic.ts";

export type TraceEvent = {
  type: "trace";
  /** ms since the run started */
  t: number;
  agent: string;
  kind: "start" | "tool_call" | "tool_result" | "llm_call" | "retry" | "warning" | "error" | "done";
  message: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cost_usd?: number;
};

export class Tracer {
  private readonly started = Date.now();
  private totalCost = 0;

  constructor(private readonly send: (line: unknown) => void) {}

  get costUsd(): number {
    return this.totalCost;
  }

  event(agent: string, kind: TraceEvent["kind"], message: string, extra: Partial<TraceEvent> = {}) {
    this.send({ type: "trace", t: Date.now() - this.started, agent, kind, message, ...extra } satisfies TraceEvent);
  }

  /** Record one model call: adds its cost to the run total and emits a trace line. */
  llmCall(agent: string, model: string, usage: Usage, message: string) {
    const cost = costUsd(model, usage);
    this.totalCost += cost;
    this.event(agent, "llm_call", message, {
      model,
      input_tokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      cost_usd: cost,
    });
  }
}
