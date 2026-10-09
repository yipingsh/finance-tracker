import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { CATEGORIES } from '../../../supabase/functions/_shared/categories'
import { buttonPrimary, Card, CardHeader, CategoryTag, Figure, input } from '../../components/ui'
import { monthlyAverages, spendingByCategory } from '../../lib/analytics'
import { db } from '../../lib/db'
import { money, monthLabel } from '../../lib/format'

const expenseCategories = CATEGORIES.filter((c) => c.kind === 'expense').map((c) => c.name)
const toCents = (raw: string) => Math.round(Number(raw.replace(/[^\d.]/g, '')) * 100)

/** One budget row: category, progress, status, editable limit. Status always has an icon and words. */
function BudgetRow({ category, budget, spent, average }: { category: string; budget: number; spent: number; average?: number }) {
  const [draft, setDraft] = useState<string | null>(null)
  const ratio = spent / budget
  const status =
    ratio > 1 ? { icon: '✗', text: `${money(spent - budget)} over`, colour: 'var(--critical)' }
    : ratio >= 0.8 ? { icon: '!', text: `${money(budget - spent)} left`, colour: 'var(--warning)' }
    : { icon: '✓', text: `${money(budget - spent)} left`, colour: 'var(--good)' }

  async function save() {
    if (draft === null) return
    const cents = toCents(draft)
    if (Number.isFinite(cents) && cents > 0) await db.budgets.put({ category, amount_cents: cents })
    setDraft(null)
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[11rem_minmax(0,1fr)_9rem_auto]">
      <CategoryTag category={category} />
      <div className="order-3 col-span-2 sm:order-none sm:col-span-1">
        <div className="h-2 rounded-full bg-(--surface-3)" title={`${Math.round(ratio * 100)}% used`}>
          <div className="h-2 rounded-full" style={{ width: `${Math.min(ratio, 1) * 100}%`, background: status.colour }} />
        </div>
        <p className="mt-1 flex justify-between text-xs text-(--text-3)">
          <span><span className="mr-1 font-bold" style={{ color: status.colour }} aria-hidden>{status.icon}</span>{status.text}</span>
          {average !== undefined && <span>avg {money(average)}/mo</span>}
        </p>
      </div>
      <p className="hidden text-right text-sm tabular-nums sm:block">
        {money(spent)} <span className="text-(--text-3)">/ {money(budget)}</span>
      </p>
      <div className="flex items-center gap-2 justify-self-end">
        <input
          aria-label={`Monthly budget for ${category}`}
          inputMode="decimal"
          value={draft ?? (budget / 100).toFixed(0)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          className={`${input} w-20 py-1 text-right tabular-nums`}
        />
        <button onClick={() => db.budgets.delete(category)} className="text-xs text-(--text-3) hover:text-(--critical)" aria-label={`Remove ${category} budget`}>
          Remove
        </button>
      </div>
    </li>
  )
}

export function BudgetsView({ month }: { month: string | null }) {
  const budgets = useLiveQuery(() => db.budgets.toArray(), [])
  const txns = useLiveQuery(() => db.transactions.toArray(), [])
  const [newCategory, setNewCategory] = useState('')
  const [newAmount, setNewAmount] = useState('')
  if (!budgets || !txns) return null

  const latest = month ?? [...new Set(txns.map((t) => t.month))].sort().at(-1) ?? null
  const spent = spendingByCategory(txns.filter((t) => t.month === latest))
  const averages = new Map(monthlyAverages(txns).map((a) => [a.category, a.average_cents]))
  const spentOf = (c: string) => spent.find((s) => s.category === c)?.cents ?? 0
  const unbudgeted = expenseCategories.filter((c) => !budgets.some((b) => b.category === c))
  const totalBudget = budgets.reduce((s, b) => s + b.amount_cents, 0)
  const totalSpent = budgets.reduce((s, b) => s + spentOf(b.category), 0)
  const over = budgets.filter((b) => spentOf(b.category) > b.amount_cents).length

  async function add() {
    const cents = toCents(newAmount)
    if (!newCategory || !Number.isFinite(cents) || cents <= 0) return
    await db.budgets.put({ category: newCategory, amount_cents: cents })
    setNewCategory('')
    setNewAmount('')
  }

  const suggested = newCategory ? averages.get(newCategory) : undefined

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Figure label="Budgeted" value={money(totalBudget)} hint={latest ? `for ${monthLabel(latest, 'long')}` : undefined} />
        <Figure label="Spent in budgeted categories" value={money(totalSpent)} hint={totalBudget ? `${Math.round((totalSpent / totalBudget) * 100)}% of budget` : undefined} />
        <Figure label="Over budget" value={`${over} of ${budgets.length}`} hint="categories" />
      </div>

      <Card>
        <CardHeader title="Your budgets" subtitle={latest ? `Progress for ${monthLabel(latest, 'long')} · edit an amount to change it` : undefined} />
        {budgets.length ? (
          <ul className="divide-y divide-(--border)">
            {budgets.map((b) => (
              <BudgetRow key={b.category} category={b.category} budget={b.amount_cents} spent={spentOf(b.category)} average={averages.get(b.category)} />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-(--text-3)">No budgets yet. Add one below.</p>
        )}
        {unbudgeted.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-(--border) bg-(--surface) px-5 py-4">
            <select aria-label="Category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className={input}>
              <option value="">Add a budget for…</option>
              {unbudgeted.map((c) => <option key={c}>{c}</option>)}
            </select>
            <input
              aria-label="Monthly amount"
              inputMode="decimal"
              placeholder={suggested ? `avg ${(suggested / 100).toFixed(0)}` : 'Amount'}
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              className={`${input} w-28 tabular-nums`}
            />
            <button onClick={add} disabled={!newCategory || !newAmount} className={buttonPrimary}>Add</button>
            {suggested !== undefined && <span className="text-xs text-(--text-3)">You usually spend {money(suggested)} a month on this</span>}
          </div>
        )}
      </Card>
    </div>
  )
}
