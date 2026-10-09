import type { TraceEvent } from '../../lib/processStatement'

// Live view of what each agent is doing: which agent, which model and how many tokens per step.
// Costs are recorded with each run but not shown to users.

const agentColour = (agent: string) =>
  agent.startsWith('orchestrator')
    ? 'bg-violet-100 text-violet-800'
    : agent.startsWith('extractor')
      ? 'bg-sky-100 text-sky-800'
      : agent.startsWith('categoriser')
        ? 'bg-amber-100 text-amber-800'
        : 'bg-emerald-100 text-emerald-800'

export function TracePanel({ events, running }: { events: TraceEvent[]; running: boolean }) {
  const calls = events.filter((e) => e.kind === 'llm_call').length

  return (
    <section className="rounded-xl card">
      <header className="flex items-center justify-between border-b border-(--border) px-4 py-2 text-sm">
        <h2 className="font-medium">Agent trace {running && <span className="ml-1 animate-pulse text-(--text-3)">running…</span>}</h2>
        <span className="text-(--text-2) tabular-nums">
          {calls} model calls
        </span>
      </header>
      <ol className="max-h-96 divide-y divide-(--border) overflow-y-auto text-sm">
        {events.map((e, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-1.5">
            <span className="w-12 shrink-0 text-right text-xs text-(--text-3) tabular-nums">{(e.t / 1000).toFixed(1)}s</span>
            <span className={`rounded px-1.5 py-0.5 text-xs ${agentColour(e.agent)}`}>{e.agent}</span>
            <span className={e.kind === 'error' || e.kind === 'warning' ? 'text-(--critical)' : ''}>{e.message}</span>
            {e.model !== undefined && (
              <span className="ml-auto text-xs text-(--text-3) tabular-nums">
                {e.model?.replace('claude-', '')} · {e.input_tokens?.toLocaleString()} in / {e.output_tokens?.toLocaleString()} out
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
