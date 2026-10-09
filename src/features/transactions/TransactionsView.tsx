import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment, useState } from 'react'
import { CATEGORY_NAMES } from '../../../supabase/functions/_shared/categories'
import { Avatar, Card, input } from '../../components/ui'
import { colourOf } from '../../lib/categoryColors'
import { db, type Txn } from '../../lib/db'
import { money, monthLabel } from '../../lib/format'
import { accountReference } from '../../lib/rules'
import { applyToAccount, applyToAllFromMerchant, recategoriseOne, similarTransactions } from '../../lib/store'

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function TransactionsView({ month }: { month: string | null }) {
  const [filterMonth, setFilterMonth] = useState<string>(month ?? 'all')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  // Shown right under the transaction that was changed, so it's where the user is looking.
  const [notice, setNotice] = useState<{ txnId: string; text: string } | null>(null)
  // After changing one transaction: offer to apply it to the same merchant, or (for transfers with an
  // account number) to every transfer from that account, now and on future uploads.
  const [offer, setOffer] = useState<{ txn: Txn; category: string; count: number; reference: string | null } | null>(null)
  const txns = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), [])
  if (!txns) return null

  const months = [...new Set(txns.map((t) => t.month))].sort().reverse()
  const q = search.trim().toLowerCase()
  const shown = txns.filter(
    (t) =>
      (filterMonth === 'all' || t.month === filterMonth) &&
      (category === 'all' || t.category === category) &&
      (!q || t.description.toLowerCase().includes(q) || t.merchant.toLowerCase().includes(q)),
  )
  const moneyOut = shown.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0)
  const moneyIn = shown.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0)

  async function change(t: Txn, next: string) {
    await recategoriseOne(t, next)
    const similar = await similarTransactions(t, next)
    const reference = accountReference(t.description)
    setNotice({ txnId: t.id, text: `Changed to ${next}.` })
    setOffer(similar.length || reference ? { txn: t, category: next, count: similar.length, reference } : null)
  }

  async function applyToAll() {
    if (!offer) return
    const moved = await applyToAllFromMerchant(offer.txn, offer.category)
    setNotice({ txnId: offer.txn.id, text: `Moved ${moved} transactions from ${offer.txn.merchant} to ${offer.category}. Future uploads will do the same.` })
    setOffer(null)
  }

  async function applyAccount() {
    if (!offer?.reference) return
    const moved = await applyToAccount(offer.txn, offer.category)
    const dir = offer.txn.amount_cents < 0 ? 'to' : 'from'
    setNotice({ txnId: offer.txn.id, text: `Every transfer ${dir} account …${offer.reference} is now ${offer.category} (${moved} so far), including future uploads.` })
    setOffer(null)
  }

  const rowVisible = notice !== null && shown.some((t) => t.id === notice.txnId)
  // Compact callout: text and buttons sit together (not pushed to opposite edges of the table).
  const small = 'rounded-md px-2.5 py-1 text-xs font-medium'
  const noticeBox = notice && (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-(--accent)/15 bg-(--accent-soft) px-3 py-2 text-sm" role="status">
      <span>
        {notice.text}
        {offer && <span className="text-(--text-2)"> Apply it more widely, including future uploads?</span>}
      </span>
      {offer && (
        <span className="flex flex-wrap gap-1.5">
          {offer.reference && (
            <button onClick={applyAccount} className={`${small} bg-(--accent) text-white hover:bg-(--accent-hover)`}>
              All transfers {offer.txn.amount_cents < 0 ? 'to' : 'from'} …{offer.reference}
            </button>
          )}
          {offer.count > 0 && (
            <button
              onClick={applyToAll}
              className={`${small} ${offer.reference ? 'border border-(--border) bg-(--surface-2) hover:bg-(--surface-3)' : 'bg-(--accent) text-white hover:bg-(--accent-hover)'}`}
            >
              All {offer.count + 1} from {offer.txn.merchant}
            </button>
          )}
          <button onClick={() => setOffer(null)} className={`${small} border border-(--border) bg-(--surface-2) hover:bg-(--surface-3)`}>Just this one</button>
        </span>
      )}
      {!offer && (
        <button onClick={() => setNotice(null)} className="ml-auto text-xs text-(--text-3) hover:text-(--text-1)" aria-label="Dismiss">✕</button>
      )}
    </div>
  )

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-(--border) px-5 py-4">
        <input aria-label="Search" placeholder="Search merchants…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${input} min-w-48 flex-1`} />
        <select aria-label="Month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} className={input}>
          <option value="all">All months</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m, 'long')}</option>)}
        </select>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
          <option value="all">All categories</option>
          {CATEGORY_NAMES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-xs text-(--text-3)">
        <span>{shown.length} of {txns.length} transactions</span>
        <span className="tabular-nums">Out {money(moneyOut)} · In {money(moneyIn)}</span>
      </div>
      {/* Fallback: if a filter hid the changed row, show the message here instead. */}
      {notice && !rowVisible && <div className="mx-5 mb-3">{noticeBox}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-(--text-3)">
            <tr className="border-y border-(--border)">
              <th className="px-5 py-2.5 font-medium">Merchant</th>
              <th className="px-3 py-2.5 font-medium">Category</th>
              <th className="px-3 py-2.5 font-medium">Date</th>
              <th className="px-5 py-2.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {shown.map((t) => (
              <Fragment key={t.id}>
              <tr className={`hover:bg-(--surface) ${notice?.txnId === t.id ? 'border-b-0 bg-(--surface)' : ''}`}>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={t.merchant || t.description} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.merchant || '—'}</p>
                      <p className="max-w-72 truncate text-xs text-(--text-3)" title={t.description}>{t.description}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {/* The dot shows the category colour; the select lets you change it. */}
                  <label className="inline-flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 hover:border-(--border)">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colourOf(t.category) }} aria-hidden />
                    <select aria-label={`Category for ${t.merchant}`} value={t.category} onChange={(e) => change(t, e.target.value)} className="bg-transparent text-xs text-(--text-2) outline-none">
                      {CATEGORY_NAMES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                  {t.confidence === 'low' && t.category_source !== 'user' && <span className="ml-1 text-xs text-(--text-3)" title="The categoriser wasn't sure about this one">?</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-(--text-2)">{shortDate(t.date)}</td>
                <td className={`whitespace-nowrap px-5 py-2.5 text-right font-medium tabular-nums ${t.amount_cents > 0 ? 'text-(--good)' : ''}`}>
                  {t.amount_cents > 0 ? '+' : ''}{money(t.amount_cents)}
                </td>
              </tr>
              {notice?.txnId === t.id && (
                <tr className="bg-(--surface)">
                  {/* Indented to line up with the merchant name (avatar 2rem + gap 0.75rem) */}
                  <td colSpan={4} className="pb-3 pl-[4.25rem] pr-5 pt-0.5">{noticeBox}</td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="px-5 py-6 text-sm text-(--text-3)">No transactions match.</p>}
      </div>
    </Card>
  )
}
