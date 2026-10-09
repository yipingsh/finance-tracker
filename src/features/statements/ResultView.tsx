import { money } from '../../lib/format'
import type { RunResult } from '../../lib/processStatement'

const outcome = {
  verified: { icon: '✓', colour: 'var(--good)' },
  unverified: { icon: '–', colour: 'var(--warning)' },
  failed: { icon: '✗', colour: 'var(--critical)' },
}
const checkIcon = { pass: '✓', fail: '✗', skipped: '–' }

export function ResultView({ result }: { result: RunResult }) {
  const { statement, transactions, verification, anomalies } = result
  const flagged = new Set(verification.issues.filter((i) => i.row !== undefined).map((i) => `${i.page}:${i.row}`))
  const o = outcome[verification.outcome]

  return (
    <section className="space-y-4">
      <div className="rounded-xl card p-4">
        <p className="font-medium capitalize">
          <span aria-hidden className="mr-1.5 font-bold" style={{ color: o.colour }}>{o.icon}</span>
          {verification.outcome}
        </p>
        <p className="text-sm text-(--text-2)">{result.summary}</p>
        <ul className="mt-2 space-y-0.5 text-sm text-(--text-2)">
          {verification.checks.map((c) => (
            <li key={c.name}>
              <span className="inline-block w-4">{checkIcon[c.status]}</span> {c.name.replaceAll('_', ' ')}: {c.detail}
            </li>
          ))}
        </ul>
        {anomalies.length > 0 && (
          <p className="mt-2 text-sm text-(--text-2)">{anomalies.length} item{anomalies.length === 1 ? '' : 's'} flagged for a look on the dashboard.</p>
        )}
      </div>

      <p className="text-sm text-(--text-2)">
        {[statement.institution, statement.account_type?.replace('_', ' '), statement.account_last4 && `ending ${statement.account_last4}`].filter(Boolean).join(' · ')}
        {statement.period_start && ` · ${statement.period_start} to ${statement.period_end}`} · {transactions.length} transactions
      </p>

      <div className="overflow-x-auto rounded-xl card">
        <table className="w-full text-sm">
          <thead className="bg-(--surface-3) text-left text-(--text-2)">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Merchant</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {transactions.map((t) => (
              <tr key={`${t.page}:${t.row}`} className={flagged.has(`${t.page}:${t.row}`) ? 'bg-(--surface-3)' : ''}>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                  {flagged.has(`${t.page}:${t.row}`) && <span className="mr-1 font-bold" style={{ color: 'var(--critical)' }} title="This row doesn't reconcile">✗</span>}
                  {t.date}
                </td>
                <td className="px-3 py-1.5">
                  <div>{t.merchant || '—'}</div>
                  <div className="text-xs text-(--text-3)">{t.description}</div>
                </td>
                <td className="px-3 py-1.5 text-(--text-2)">{t.category}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(t.amount_cents)}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-(--text-3) tabular-nums">
                  {t.balance_after_cents === null ? '' : money(t.balance_after_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
