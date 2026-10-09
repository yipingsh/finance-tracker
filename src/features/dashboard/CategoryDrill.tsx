import type { Txn } from '../../lib/db'
import type { Segment } from '../../lib/categoryColors'
import { money } from '../../lib/format'

/** What was spent in the selected category this month: merchants as bars, then the transactions. */
export function CategoryDrill({
  segment,
  txns,
  averageCents,
  totalCents,
  onClose,
}: {
  segment: Segment
  txns: Txn[]
  averageCents: number | null
  totalCents: number
  onClose: () => void
}) {
  const inCategory = txns
    .filter((t) => segment.categories.includes(t.category))
    .sort((a, b) => b.date.localeCompare(a.date))

  const merchants = new Map<string, { name: string; cents: number; count: number }>()
  for (const t of inCategory) {
    const key = (t.merchant || t.description).trim().toLowerCase()
    const m = merchants.get(key) ?? { name: t.merchant || t.description, cents: 0, count: 0 }
    m.cents -= t.amount_cents
    m.count++
    merchants.set(key, m)
  }
  const topMerchants = [...merchants.values()].sort((a, b) => b.cents - a.cents).slice(0, 6)
  const max = Math.max(...topMerchants.map((m) => m.cents), 1)
  const vsAverage = averageCents ? Math.round(((segment.cents - averageCents) / averageCents) * 100) : null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <span className="h-3 w-3 rounded-sm" style={{ background: segment.colour }} aria-hidden />
            {segment.label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(segment.cents)}</p>
          <p className="text-xs text-(--text-3)">
            {Math.round((segment.cents / totalCents) * 100)}% of spending · {segment.count} transaction{segment.count === 1 ? '' : 's'}
            {vsAverage !== null && ` · ${vsAverage >= 0 ? '▲' : '▼'} ${Math.abs(vsAverage)}% vs your average`}
          </p>
          {segment.categories.length > 1 && <p className="mt-1 text-xs text-(--text-3)">Includes {segment.categories.join(', ')}</p>}
        </div>
        <button onClick={onClose} className="text-sm text-(--link) hover:underline">Close</button>
      </div>

      <ul className="mt-4 space-y-1.5" aria-label="Top merchants">
        {topMerchants.map((m) => (
          <li key={m.name} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-sm" title={`${m.name}: ${money(m.cents)} over ${m.count} transaction${m.count === 1 ? '' : 's'}`}>
            <span className="truncate text-(--text-2)">{m.name}</span>
            <span className="h-2.5">
              <span className="block h-2.5 rounded-r-[4px]" style={{ width: `${Math.max((m.cents / max) * 100, 2)}%`, background: segment.colour }} />
            </span>
            <span className="tabular-nums">{money(m.cents)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 max-h-60 flex-1 overflow-y-auto border-t border-(--border) pr-3 [scrollbar-gutter:stable]">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-(--border)">
            {inCategory.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap py-1.5 pr-2 text-xs text-(--text-3) tabular-nums">{t.date.slice(5)}</td>
                <td className="py-1.5 pr-2">{t.merchant || t.description}</td>
                <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{money(-t.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
