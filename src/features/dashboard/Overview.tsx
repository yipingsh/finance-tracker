import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { kindOf } from '../../../supabase/functions/_shared/categories.ts'
import { Icon } from '../../components/icons'
import { Avatar, CardHeader } from '../../components/ui'
import { detectRecurring, incomeSources, monthlyAverages, monthlyTotals, spendingByCategory } from '../../lib/analytics'
import { colourOf, toSegments } from '../../lib/categoryColors'
import { db, type Txn } from '../../lib/db'
import { money, monthLabel } from '../../lib/format'
import { CategoryDrill } from './CategoryDrill'
import { BudgetMeter, PaceChart, StatTile } from './charts'
import { DonutChart } from './DonutChart'
import { IncomeCard } from './IncomeCard'
import { InsightCard } from './InsightCard'

const card = 'rounded-xl card'

/** Running total of spending per day of the month. */
function cumulative(txns: Txn[], days: number, upToDay: number): number[] {
  const perDay = new Array(days).fill(0)
  for (const t of txns) if (kindOf(t.category) === 'expense') perDay[Number(t.date.slice(8, 10)) - 1] -= t.amount_cents
  const out: number[] = []
  let sum = 0
  for (const v of perDay.slice(0, upToDay)) out.push((sum += v))
  return out
}

const daysIn = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function Overview({ month, onMonth, onUpload, onDemo, onViewTransactions, demo }: {
  month: string | null
  onMonth: (m: string) => void
  onUpload: () => void
  onDemo: () => void
  onViewTransactions: () => void
  demo?: boolean
}) {
  const txns = useLiveQuery(() => db.transactions.toArray(), [])
  const budgets = useLiveQuery(() => db.budgets.toArray(), [])
  const anomalies = useLiveQuery(() => db.anomalies.where('status').equals('open').toArray(), [])
  const [selected, setSelected] = useState<string | null>(null)
  const [showAllFlags, setShowAllFlags] = useState(false)

  if (!txns || !budgets || !anomalies) return null
  if (txns.length === 0) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Overview</h1>
        <div className={`${card} p-10 text-center`}>
          <p className="font-medium">No statements yet</p>
          <p className="mt-1 text-sm text-(--text-2)">Upload a statement from any bank, card or e-wallet, or explore the demo.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button onClick={onUpload} className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-white hover:bg-(--accent-hover)">Upload a statement</button>
            <button onClick={onDemo} className="rounded-lg border border-(--border) px-4 py-2 text-sm font-medium hover:bg-(--surface-3)">Try the demo</button>
          </div>
        </div>
      </>
    )
  }

  const months = monthlyTotals(txns)
  const current = months.find((m) => m.month === month) ?? months[months.length - 1]
  const idx = months.indexOf(current)
  const previous = months[idx - 1]
  const monthTxns = txns.filter((t) => t.month === current.month)
  const byCategory = spendingByCategory(monthTxns)
  const segments = toSegments(byCategory)
  const selectedSegment = segments.find((s) => s.label === selected) ?? null
  const averages = new Map(monthlyAverages(txns.filter((t) => t.month < current.month)).map((a) => [a.category, a.average_cents]))
  const segmentAverage = selectedSegment
    ? selectedSegment.categories.reduce<number | null>((s, c) => (averages.has(c) ? (s ?? 0) + averages.get(c)! : s), null)
    : null
  const top = byCategory[0]
  const pct = (now: number, before?: number) => (before ? Math.round(((now - before) / before) * 100) : null)
  const history = months.slice(Math.max(0, idx - 5), idx + 1)
  // Savings rate: the share of income not spent. Money moved into savings or investments counts as
  // kept, since it's a transfer, not spending. No income means no rate, rather than a false 0%.
  const rateOf = (m: { income: number; net: number }) => (m.income > 0 ? Math.round((m.net / m.income) * 100) : null)
  const savingsRate = rateOf(current)
  const previousRate = previous ? rateOf(previous) : null
  const rateHistory = history.map(rateOf).filter((r): r is number => r !== null)
  const pctText = (r: number) => `${r < 0 ? '−' : ''}${Math.abs(r)}%`
  // Money moved out to your own accounts or investments: not spending, but worth seeing.
  const notSpending = new Map<string, number>()
  // And money moved in from them: not income.
  const notIncome = new Map<string, number>()
  for (const t of monthTxns) {
    if (kindOf(t.category) !== 'transfer') continue
    if (t.amount_cents < 0) notSpending.set(t.category, (notSpending.get(t.category) ?? 0) - t.amount_cents)
    else notIncome.set(t.category, (notIncome.get(t.category) ?? 0) + t.amount_cents)
  }
  const invested = notSpending.get('Investments & Savings') ?? 0
  const savingsFooter = savingsRate === null ? 'No income this month' : [
    previous && previousRate !== null ? `${pctText(previousRate)} in ${monthLabel(previous.month)}` : null,
    invested > 0 ? `${money(invested)} invested` : null,
  ].filter(Boolean).join(' · ') || 'Share of income not spent'
  const sources = incomeSources(txns, current.month)

  // Spending pace: this month so far against the whole previous month.
  const days = daysIn(current.month)
  const lastDay = Math.min(days, Math.max(1, ...monthTxns.map((t) => Number(t.date.slice(8, 10)))))
  const pace = cumulative(monthTxns, days, lastDay)
  const prevPace = previous ? cumulative(txns.filter((t) => t.month === previous.month), daysIn(previous.month), daysIn(previous.month)) : []

  const recent = [...monthTxns].sort((a, b) => b.date.localeCompare(a.date) || a.row - b.row).slice(0, 6)
  const upcoming = detectRecurring(txns.filter((t) => t.month <= current.month)).slice(0, 5)
  const txnById = new Map(txns.map((t) => [t.id, t]))
  const flags = showAllFlags ? anomalies : anomalies.slice(0, 3)
  const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${monthLabel(iso.slice(0, 7)).split(' ')[0]}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-(--text-2)">Your money in {monthLabel(current.month, 'long')}</p>
        </div>
        <label className="text-sm">
          <span className="sr-only">Month</span>
          <select id="month" value={current.month} onChange={(e) => { onMonth(e.target.value); setSelected(null) }} className="card rounded-lg px-3 py-1.5 text-sm font-medium">
            {months.map((mo) => <option key={mo.month} value={mo.month}>{monthLabel(mo.month, 'long')}</option>)}
          </select>
        </label>
      </div>

      <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div title="Transfers between your own accounts and into investments aren't counted as spending or income.">
          <StatTile label="Spent" value={money(current.spent)} deltaPct={pct(current.spent, previous?.spent)} footer={previous ? `vs ${monthLabel(previous.month)}` : 'First month uploaded'} spark={{ values: history.map((m) => m.spent), label: 'Monthly spending trend' }} />
        </div>
        <StatTile label="Income" value={money(current.income)} deltaPct={pct(current.income, previous?.income)} footer={previous ? `vs ${monthLabel(previous.month)}` : 'First month uploaded'} spark={{ values: history.map((m) => m.income), label: 'Monthly income trend' }} />
        <StatTile label="Net" value={money(current.net)} footer="Income minus spending" spark={{ values: history.map((m) => m.net), label: 'Monthly net trend' }} />
        <div title="The share of your income you didn't spend. Money moved into savings or investments counts as kept.">
          <StatTile
            label="Savings rate"
            value={savingsRate === null ? '–' : pctText(savingsRate)}
            footer={savingsFooter}
            spark={{ values: rateHistory, label: 'Monthly savings rate trend' }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className={`${card} xl:col-span-7`}>
          <CardHeader
            title="Where your money went"
            subtitle={top ? `Biggest: ${top.category}, ${Math.round((top.cents / current.spent) * 100)}% · Select a category for details` : undefined}
          />
          <div className="p-5">
            <DonutChart segments={segments} selected={selected} onSelect={setSelected} />
            {notSpending.size > 0 && (
              <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-(--border) pt-3 text-xs text-(--text-3)" title="Moving money to your own accounts or investments isn't spending: you still have it.">
                <span>Not counted as spending:</span>
                {[...notSpending.entries()].map(([category, cents]) => (
                  <span key={category} className="text-(--text-2)">
                    {category} <span className="font-medium tabular-nums text-(--text-1)">{money(cents)}</span>
                  </span>
                ))}
              </p>
            )}
          </div>
        </section>
        {selectedSegment ? (
          // Selecting a category swaps the pace chart for that category's details.
          <section className={`${card} p-5 xl:col-span-5`}>
            <CategoryDrill segment={selectedSegment} txns={monthTxns} averageCents={segmentAverage} totalCents={current.spent} onClose={() => setSelected(null)} />
          </section>
        ) : (
          <section className={`${card} xl:col-span-5`}>
            <CardHeader title="Spending pace" subtitle={previous ? `Running total vs ${monthLabel(previous.month)}` : 'Running total this month'} />
            <div className="p-5">
              <PaceChart current={pace} previous={prevPace} currentLabel={monthLabel(current.month)} previousLabel={previous ? monthLabel(previous.month) : ''} />
              {prevPace.length > 0 && (() => {
                // Same point in each month: by the last day with data this month.
                const day = pace.length
                const now = pace[day - 1] ?? 0
                const then = prevPace[Math.min(day, prevPace.length) - 1] ?? 0
                const diff = now - then
                return (
                  <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-(--border) pt-4 text-sm">
                    <div>
                      <dt className="text-xs text-(--text-3)">By day {day}</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums">{money(now)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-(--text-3)">{monthLabel(previous!.month).split(' ')[0]} by day {day}</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums">{money(then)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-(--text-3)">Difference</dt>
                      <dd className="mt-0.5 flex items-center gap-1 font-semibold tabular-nums">
                        <Icon name={diff >= 0 ? 'arrowUpRight' : 'arrowDownRight'} className="h-3.5 w-3.5 text-(--text-3)" />
                        {money(Math.abs(diff))} {diff >= 0 ? 'more' : 'less'}
                      </dd>
                    </div>
                  </dl>
                )
              })()}
            </div>
          </section>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <IncomeCard sources={sources} transfersIn={notIncome} />
        </div>

        <div className="space-y-6 xl:col-span-5">
          <section className={card}>
            <CardHeader title="Recurring payments" subtitle="Subscriptions and bills found in your statements" />
            {upcoming.length ? (
              <ul className="divide-y divide-(--border)">
                {upcoming.map((r) => (
                  <li key={r.merchant} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={r.merchant} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.merchant}</p>
                      <p className="text-xs text-(--text-3)">{r.next_expected ? `Next around ${shortDate(r.next_expected)}` : 'Seen once so far'}</p>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{money(r.typical_amount_cents)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-4 text-sm text-(--text-3)">None found yet.</p>}
          </section>

          <section className={card}>
            <CardHeader title="Budgets" />
            <div className="space-y-4 p-5">
              {budgets.length ? budgets.map((b) => (
                <BudgetMeter key={b.category} category={b.category} budget={b.amount_cents} spent={byCategory.find((c) => c.category === b.category)?.cents ?? 0} />
              )) : <p className="text-sm text-(--text-3)">No budgets yet. Set them in the Budgets tab.</p>}
            </div>
          </section>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* self-start: sized to its rows, so it doesn't stretch to match the column beside it */}
        <section className={`${card} self-start xl:col-span-7`}>
          <CardHeader
            title="Recent transactions"
            action={
              <button onClick={onViewTransactions} className="flex items-center gap-0.5 text-sm font-medium text-(--link) hover:underline">
                View all <Icon name="chevronRight" className="h-3.5 w-3.5" />
              </button>
            }
          />
          <ul className="divide-y divide-(--border)">
            {recent.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={t.merchant || t.description} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.merchant || t.description}</p>
                  <p className="flex items-center gap-1.5 text-xs text-(--text-3)">
                    <span className="h-2 w-2 rounded-full" style={{ background: colourOf(t.category) }} aria-hidden />
                    {t.category} · {shortDate(t.date)}
                  </p>
                </div>
                <span className={`text-sm font-medium tabular-nums ${t.amount_cents > 0 ? 'text-(--good)' : ''}`}>
                  {t.amount_cents > 0 ? '+' : ''}{money(t.amount_cents)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-6 xl:col-span-5">
          {/* Read-only in the demo: a demo visitor never triggers AI calls. */}
          <InsightCard month={current.month} readOnly={demo} />
          <section className={card}>
            <CardHeader title="Worth a look" subtitle={anomalies.length ? `${anomalies.length} flagged by the anomaly checker` : undefined} />
            {anomalies.length === 0 ? <p className="px-5 py-4 text-sm text-(--text-3)">Nothing flagged.</p> : (
              <ul className="divide-y divide-(--border)">
                {flags.map((a) => {
                  const related = a.transaction_ids.map((id) => txnById.get(id)).filter(Boolean)
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm" title={related.map((t) => `${t!.date} ${money(t!.amount_cents)}`).join(' · ')}>
                      <span>
                        <span className="mr-2 rounded-md border border-(--border) px-1.5 py-0.5 text-xs text-(--text-2)">{a.kind.replace('_', ' ')}</span>
                        {a.explanation}
                      </span>
                      <button onClick={() => db.anomalies.update(a.id, { status: 'dismissed' })} className="shrink-0 text-xs font-medium text-(--link) hover:underline">Dismiss</button>
                    </li>
                  )
                })}
                {anomalies.length > 3 && (
                  <li className="px-5 py-3">
                    <button onClick={() => setShowAllFlags(!showAllFlags)} className="text-xs font-medium text-(--link) hover:underline">
                      {showAllFlags ? 'Show fewer' : `Show all ${anomalies.length}`}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>
        </div>
      </div>

    </div>
  )
}
