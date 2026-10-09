import { Icon } from '../../components/icons'
import { CardHeader } from '../../components/ui'
import type { IncomePayer, IncomeSource } from '../../lib/analytics'
import { money } from '../../lib/format'

// Income by type, then by who paid it. The category colours already stand for spending
// categories, so the share bars here are one neutral ink, and "regular" is shown with an icon and
// a word rather than a colour.

const MAX_PAYERS = 4

const PATTERN: Record<IncomePayer['pattern'], { label: string; title: string }> = {
  regular: { label: 'Regular', title: 'Paid in at least two months, a similar amount around the same day' },
  'one-off': { label: 'One-off', title: 'Not seen at a steady amount in other months' },
  'first-month': { label: 'Seen once so far', title: 'Upload more months to see if this repeats' },
}

export function IncomeCard({ sources, transfersIn }: {
  sources: IncomeSource[]
  /** Money moved in from your own accounts or investments: not income, but worth seeing. */
  transfersIn: Map<string, number>
}) {
  const total = sources.reduce((s, x) => s + x.cents, 0)
  const regular = sources.flatMap((s) => s.payers).filter((p) => p.pattern === 'regular').reduce((s, p) => s + p.cents, 0)
  const firstMonth = sources.some((s) => s.payers.some((p) => p.pattern === 'first-month'))
  const subtitle = total === 0 ? undefined
    : regular > 0 ? `${money(regular)} regular · ${Math.round((regular / total) * 100)}% of income`
    : firstMonth ? 'Upload more months to see which income is regular'
    : 'No regular income found this month'

  return (
    <section className="rounded-xl card">
      <CardHeader title="Where your money came from" subtitle={subtitle} />
      <div className="p-5">
        {total === 0 ? <p className="text-sm text-(--text-3)">No income this month.</p> : (
          <ul className="space-y-4" aria-label="Income by type">
            {sources.map((s) => (
              <li key={s.category}>
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium">{s.category}</span>
                  <span className="font-medium tabular-nums">{money(s.cents)}</span>
                  <span className="w-9 text-right text-xs text-(--text-3) tabular-nums">{s.cents / total < 0.005 ? '<1' : Math.round((s.cents / total) * 100)}%</span>
                </div>
                <span className="mt-1.5 block h-1 rounded-full bg-(--surface-3)">
                  <span className="block h-1 rounded-full bg-(--chart-ink)" style={{ width: `${(s.cents / total) * 100}%` }} />
                </span>
                <ul className="mt-2 space-y-1.5">
                  {s.payers.slice(0, MAX_PAYERS).map((p) => (
                    <li key={p.name} className="flex items-center gap-2 pl-3 text-sm">
                      <span className="min-w-0 truncate text-(--text-2)">{p.name}</span>
                      <span title={PATTERN[p.pattern].title} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-(--border) px-1.5 py-0.5 text-xs text-(--text-2)">
                        {p.pattern === 'regular' && <Icon name="subscriptions" className="h-3 w-3" />}
                        {PATTERN[p.pattern].label}
                      </span>
                      <span className="ml-auto shrink-0 tabular-nums text-(--text-2)">{money(p.cents)}</span>
                    </li>
                  ))}
                  {s.payers.length > MAX_PAYERS && (
                    <li className="pl-3 text-xs text-(--text-3)">
                      and {s.payers.length - MAX_PAYERS} more ({money(s.payers.slice(MAX_PAYERS).reduce((sum, p) => sum + p.cents, 0))})
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {transfersIn.size > 0 && (
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-(--border) pt-3 text-xs text-(--text-3)" title="Money moved in from your own accounts isn't new income: you already had it.">
            <span>Not counted as income:</span>
            {[...transfersIn.entries()].map(([category, cents]) => (
              <span key={category} className="text-(--text-2)">
                {category} <span className="font-medium tabular-nums text-(--text-1)">{money(cents)}</span>
              </span>
            ))}
          </p>
        )}
      </div>
    </section>
  )
}
