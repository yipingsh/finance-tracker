import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../../lib/db'
import { monthLabel } from '../../lib/format'
import { writeInsight } from '../../lib/insights'

export function InsightCard({ month, readOnly }: { month: string; readOnly?: boolean }) {
  // undefined while loading, null when this month has no summary
  const insight = useLiveQuery(() => db.insights.get(month).then((i) => i ?? null), [month])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  async function generate() {
    setBusy(true)
    setError('')
    try {
      await writeInsight(month)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Summary · {monthLabel(month, 'long')}</h2>
        {/* Summaries are written automatically after each upload; this is only a retry if that failed. */}
        {!readOnly && insight === null && (
          <button onClick={generate} disabled={busy} className="text-sm text-(--link) hover:underline disabled:opacity-50">
            {busy ? 'Writing…' : 'Write summary'}
          </button>
        )}
      </div>
      {insight ? (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-base">{insight.headline}</p>
          <button onClick={() => setExpanded(!expanded)} className="text-sm text-(--link) hover:underline">
            {expanded ? 'Show less' : 'Read more'}
          </button>
          {expanded && <>
          <ul className="list-disc space-y-1 pl-5 text-(--text-2)">
            {insight.observations.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
          {insight.suggestions.length > 0 && (
            <div>
              <p className="font-medium">Ideas</p>
              <ul className="list-disc space-y-1 pl-5 text-(--text-2)">
                {insight.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          <p className="text-xs text-(--text-3)">
            Written by Claude ({insight.model.replace('claude-', '')}) from a summary of your month: totals and merchants only, no individual
            transactions. Not financial advice.
          </p>
          </>}
        </div>
      ) : (
        <p className="mt-2 text-sm text-(--text-3)">
          {readOnly ? 'No summary for this month.' : 'No summary for this month yet. One is written automatically after each upload; only totals and merchant names are sent.'}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-(--critical)">{error}</p>}
    </section>
  )
}
