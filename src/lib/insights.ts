import { summariseMonth, summaryBasis, type MonthSummary } from './analytics'
import { db, type Insight } from './db'
import { supabase } from './supabase'

export async function buildMonthSummary(month: string): Promise<MonthSummary> {
  const [txns, budgets, anomalies] = await Promise.all([
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.anomalies.where('status').equals('open').toArray(),
  ])
  const inMonth = new Set(txns.filter((t) => t.month === month).map((t) => t.id))
  const flags = anomalies.filter((a) => a.transaction_ids.some((id) => inMonth.has(id)))
  return summariseMonth(txns, month, budgets, flags)
}

/**
 * Whether a month's saved summary quotes figures that have since changed (e.g. after
 * recategorising). Runs entirely in the browser; no AI call.
 */
export async function isInsightOutOfDate(month: string): Promise<boolean> {
  const insight = await db.insights.get(month)
  if (!insight) return false
  if (insight.basis) return insight.basis !== summaryBasis(await buildMonthSummary(month))
  // Older summaries didn't save their figures: assume out of date if anything in the month was recategorised.
  const changed = await db.transactions.where('month').equals(month)
    .filter((t) => t.category_source === 'user' || t.category_source === 'user_rule').count()
  return changed > 0
}

/** Asks the insight writer for a summary of the month and saves it in this browser. */
export async function writeInsight(month: string): Promise<Insight> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Not signed in.')
  const summary = await buildMonthSummary(month)
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-insights`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(summary),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `Couldn't write the summary (${res.status}).`)
  const insight: Insight = { month, ...body.insight, generated_at: new Date().toISOString(), model: body.model, basis: summaryBasis(summary) }
  await db.insights.put(insight)
  return insight
}
