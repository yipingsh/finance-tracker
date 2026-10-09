import { useLiveQuery } from 'dexie-react-hooks'
import { Avatar, Card, CardHeader, CategoryTag, Figure } from '../../components/ui'
import { detectRecurring, type Recurring } from '../../lib/analytics'
import { db } from '../../lib/db'
import { money } from '../../lib/format'

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function RecurringList({ rows }: { rows: Recurring[] }) {
  return (
    <ul className="divide-y divide-(--border)">
      {rows.map((r) => (
        <li key={r.merchant} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_8rem_auto]">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={r.merchant} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{r.merchant}</p>
              <CategoryTag category={r.category} />
            </div>
          </div>
          <p className="hidden text-xs text-(--text-3) sm:block">Last charged {shortDate(r.last_date)}</p>
          <p className="hidden text-xs text-(--text-2) sm:block">{r.next_expected ? `Next ~${shortDate(r.next_expected)}` : `Seen in ${r.months_seen} month`}</p>
          <p className="text-right text-sm font-medium tabular-nums">
            {money(r.typical_amount_cents)}
            {r.status === 'confirmed' && <span className="text-xs font-normal text-(--text-3)">/mo</span>}
          </p>
        </li>
      ))}
    </ul>
  )
}

export function SubscriptionsView() {
  const txns = useLiveQuery(() => db.transactions.toArray(), [])
  if (!txns) return null
  const recurring = detectRecurring(txns)
  const confirmed = recurring.filter((r) => r.status === 'confirmed')
  const possible = recurring.filter((r) => r.status === 'possible')
  const monthly = confirmed.reduce((s, r) => s + r.typical_amount_cents, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Figure label="Recurring payments" value={String(confirmed.length)} />
        <Figure label="Per month" value={money(monthly)} />
        <Figure label="Per year" value={money(monthly * 12)} hint="if nothing changes" />
      </div>

      <Card>
        <CardHeader title="Recurring" subtitle="Charged at a steady amount, around the same day, in at least two months" />
        {confirmed.length ? <RecurringList rows={confirmed} /> : <p className="px-5 py-6 text-sm text-(--text-3)">None confirmed yet. They appear once two months of statements are uploaded.</p>}
      </Card>

      {possible.length > 0 && (
        <Card>
          <CardHeader title="Possible subscriptions" subtitle="Look like subscriptions but seen in only one month so far" />
          <RecurringList rows={possible} />
        </Card>
      )}
    </div>
  )
}
