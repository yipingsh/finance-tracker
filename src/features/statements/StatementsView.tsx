import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment, useRef, useState } from 'react'
import { Icon } from '../../components/icons'
import { buttonPrimary, buttonSecondary, Card, CardHeader, Figure, StatusBadge } from '../../components/ui'
import { db, type Account, type Statement } from '../../lib/db'
import { deleteStatement, exportBackup, importBackup } from '../../lib/store'
import { ReplayTrace } from '../trace/ReplayTrace'
import { TracePanel } from '../trace/TracePanel'

const checkIcon = { pass: '✓', fail: '✗', skipped: '–' }

const CHECK_NAMES: Record<string, string> = {
  has_transactions: 'Transactions found',
  running_balance: 'Running balance',
  page_continuity: 'Balances between pages',
  totals: 'Printed totals',
  opening_to_closing: 'Opening + movements = closing',
  dates_in_period: 'Dates within period',
}

function accountName(a: Account | undefined, s: Statement): string {
  if (!a) return s.file_name
  const kind = a.account_type === 'credit_card' ? 'Card' : a.account_type === 'e_wallet' ? 'Wallet' : 'Account'
  // "Sample Card Services" + "Card" would repeat itself
  if (a.institution && new RegExp(kind, 'i').test(a.institution)) return a.institution
  return [a.institution, kind].filter(Boolean).join(' ')
}

const period = (s: Statement) => {
  if (!s.period_start || !s.period_end) return '—'
  const f = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(s.period_start)} – ${f(s.period_end)} ${s.period_end.slice(0, 4)}`
}

export function StatementsView() {
  const statements = useLiveQuery(() => db.statements.orderBy('period_start').reverse().toArray(), [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [])
  const counts = useLiveQuery(async () => {
    const all = await db.transactions.toArray()
    return all.reduce<Record<string, number>>((m, t) => ({ ...m, [t.statement_id]: (m[t.statement_id] ?? 0) + 1 }), {})
  }, [])
  const [open, setOpen] = useState<{ id: string; view: 'details' | 'replay' } | null>(null)
  const run = useLiveQuery(() => (open ? db.runs.where('statement_id').equals(open.id).first() : undefined), [open?.id])
  const [message, setMessage] = useState('')
  const importInput = useRef<HTMLInputElement>(null)
  if (!statements || !accounts || !counts) return null

  async function download() {
    const url = URL.createObjectURL(await exportBackup())
    const a = document.createElement('a')
    a.href = url
    a.download = `finance-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function restore(file: File) {
    if (!confirm('Replace everything in this browser with the backup?')) return
    try {
      await importBackup(file)
      setMessage('Backup restored.')
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  const toggle = (id: string, view: 'details' | 'replay') => setOpen(open?.id === id && open.view === view ? null : { id, view })
  const totalTxns = Object.values(counts).reduce((s, n) => s + n, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Figure label="Statements" value={String(statements.length)} />
        <Figure label="Transactions" value={totalTxns.toLocaleString()} />
      </div>

      <Card>
        <CardHeader title="Processed statements" subtitle="Select a row to see how it was checked" />
        {statements.length === 0 ? (
          <p className="px-5 py-6 text-sm text-(--text-3)">No statements uploaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-(--text-3)">
                <tr className="border-b border-(--border)">
                  <th className="px-5 py-2.5 font-medium">Account</th>
                  <th className="px-3 py-2.5 font-medium">Period</th>
                  <th className="px-3 py-2.5 text-right font-medium">Transactions</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => {
                  const account = accounts.find((a) => a.id === s.account_id)
                  const isOpen = open?.id === s.id
                  return (
                    <Fragment key={s.id}>
                      <tr className={`cursor-pointer border-b border-(--border) hover:bg-(--surface-3) ${isOpen ? 'bg-(--surface-3)' : ''}`} onClick={() => toggle(s.id, 'details')}>
                        <td className="px-5 py-3">
                          <p className="font-medium">{accountName(account, s)}</p>
                          {account?.last4 && <p className="text-xs text-(--text-3)">•••• {account.last4}</p>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-(--text-2)">{period(s)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{counts[s.id] ?? 0}</td>
                        <td className="px-3 py-3"><StatusBadge outcome={s.outcome} /></td>
                        <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <span className="inline-flex items-center gap-3 whitespace-nowrap text-xs font-medium">
                            <button onClick={() => toggle(s.id, 'replay')} className="text-(--link) hover:underline">Replay</button>
                            <button
                              onClick={() => confirm('Delete this statement and its transactions from this browser?') && deleteStatement(s.id)}
                              className="text-(--text-3) hover:text-(--critical)"
                            >
                              Delete
                            </button>
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-(--border) bg-(--surface)">
                          <td colSpan={5} className="px-5 py-4">
                            {open.view === 'replay' && run ? (
                              <ReplayTrace key={run.id} events={run.events} />
                            ) : (
                              <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide text-(--text-3)">Checks</p>
                                  <ul className="mt-2 space-y-1 text-sm">
                                    {s.checks.map((c) => (
                                      <li key={c.name} className="flex gap-2">
                                        <span className="w-3 text-(--text-3)" aria-hidden>{checkIcon[c.status]}</span>
                                        <span>{CHECK_NAMES[c.name] ?? c.name.replaceAll('_', ' ')}</span>
                                        {c.detail.toLowerCase() !== (CHECK_NAMES[c.name] ?? '').toLowerCase() && (
                                          <span className="text-(--text-3)">· {c.detail}</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-(--text-3)">Agent summary</p>
                                  <p className="mt-1 text-sm text-(--text-2)">{s.summary}</p>
                                </div>
                                {run && <TracePanel events={run.events} running={false} />}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex gap-3">
            <span className="mt-0.5 text-(--text-3)"><Icon name="lock" /></span>
            <div>
              <h2 className="font-semibold">Backup</h2>
              <p className="text-sm text-(--text-2)">Your data lives only in this browser. Keep a copy in case you clear it or switch devices.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={download} className={buttonPrimary}>Download backup</button>
            <button onClick={() => importInput.current?.click()} className={buttonSecondary}>Restore</button>
            <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restore(f) }} />
          </div>
        </div>
        {message && <p className="border-t border-(--border) px-5 py-3 text-sm text-(--text-2)">{message}</p>}
      </Card>
    </div>
  )
}
