import { kindOf } from '../../supabase/functions/_shared/categories.ts'

// Pure functions over transactions: no database, no React, so they are easy to unit-test.

export type TxnLike = { date: string; month: string; merchant: string; category: string; amount_cents: number }

export type MonthTotals = { month: string; spent: number; income: number; net: number }

/** Spending and income per month. Transfers between own accounts count as neither. */
export function monthlyTotals(txns: TxnLike[]): MonthTotals[] {
  const byMonth = new Map<string, MonthTotals>()
  for (const t of txns) {
    const m = byMonth.get(t.month) ?? { month: t.month, spent: 0, income: 0, net: 0 }
    const kind = kindOf(t.category)
    // A refund categorised as spending (e.g. a returned purchase) reduces that month's spending.
    if (kind === 'expense') m.spent -= t.amount_cents
    else if (kind === 'income') m.income += t.amount_cents
    m.net = m.income - m.spent
    byMonth.set(t.month, m)
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
}

/** Spending per category for the given transactions, largest first. */
export function spendingByCategory(txns: TxnLike[]): { category: string; cents: number; count: number }[] {
  const totals = new Map<string, { cents: number; count: number }>()
  for (const t of txns) {
    if (kindOf(t.category) !== 'expense') continue
    const c = totals.get(t.category) ?? { cents: 0, count: 0 }
    c.cents -= t.amount_cents
    c.count++
    totals.set(t.category, c)
  }
  return [...totals.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .filter((c) => c.cents > 0)
    .sort((a, b) => b.cents - a.cents)
}

export type Recurring = {
  merchant: string
  category: string
  typical_amount_cents: number
  months_seen: number
  last_date: string
  next_expected: string | null
  /** "confirmed": seen in 2+ months at a steady amount; "possible": a subscription seen once so far. */
  status: 'confirmed' | 'possible'
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)
}

/** Everyday spending: a regular grocery run or coffee is a habit, not a recurring payment. */
const EVERYDAY_CATEGORIES = new Set(['Food & Drink', 'Groceries', 'Transport', 'Shopping'])
/** Bills can vary month to month (electricity, phone); other recurring charges (rent, gym) are fixed. */
const VARIABLE_CATEGORIES = new Set(['Bills & Utilities', 'Subscriptions'])
const DAY_TOLERANCE = 6

/** Distance between two days of the month, wrapping around month ends (30th vs 2nd = 2 days). */
const dayGap = (a: number, b: number) => Math.min(Math.abs(a - b), 30 - Math.abs(a - b))

/** Is there a day of the month that every month has a charge near? */
function sharedDayOfMonth(txns: TxnLike[]): boolean {
  const byMonth = new Map<string, number[]>()
  for (const t of txns) byMonth.set(t.month, [...(byMonth.get(t.month) ?? []), Number(t.date.slice(8, 10))])
  const candidates = [...byMonth.values()][0] ?? []
  return candidates.some((d) => [...byMonth.values()].every((days) => days.some((x) => dayGap(x, d) <= DAY_TOLERANCE)))
}

/**
 * Recurring payments, found with plain rules rather than AI: outside everyday categories, the same
 * merchant charging a fixed amount (within 1% of its median, or 15% for bills and subscriptions)
 * around the same day of the month (within 6 days) in at least two different months.
 * Merchants the categoriser filed under "Subscriptions" but not confirmed this way are "possible".
 */
export function detectRecurring(txns: TxnLike[]): Recurring[] {
  const groups = new Map<string, TxnLike[]>()
  for (const t of txns) {
    if (t.amount_cents >= 0 || !t.merchant || kindOf(t.category) !== 'expense' || EVERYDAY_CATEGORIES.has(t.category)) continue
    const key = t.merchant.toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), t])
  }

  const out: Recurring[] = []
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
    const amounts = sorted.map((t) => -t.amount_cents)
    const typical = median(amounts)
    const last = sorted[sorted.length - 1]
    const tolerance = VARIABLE_CATEGORIES.has(last.category) ? 0.15 : 0.01
    const steady = sorted.filter((t) => Math.abs(-t.amount_cents - typical) <= typical * tolerance)
    const months = new Set(steady.map((t) => t.month))
    const isSubscription = sorted.some((t) => t.category === 'Subscriptions')
    // A recurring payment comes about once a month, not many times.
    const perMonth = steady.length / Math.max(months.size, 1)

    if (months.size >= 2 && perMonth <= 2 && sharedDayOfMonth(steady)) {
      const next = new Date(`${last.date}T00:00:00Z`)
      next.setUTCMonth(next.getUTCMonth() + 1)
      out.push({ merchant: last.merchant, category: last.category, typical_amount_cents: typical, months_seen: months.size, last_date: last.date, next_expected: next.toISOString().slice(0, 10), status: 'confirmed' })
    } else if (isSubscription) {
      out.push({ merchant: last.merchant, category: last.category, typical_amount_cents: typical, months_seen: months.size, last_date: last.date, next_expected: null, status: 'possible' })
    }
  }
  return out.sort((a, b) => b.typical_amount_cents - a.typical_amount_cents)
}

export type MonthSummary = {
  month: string
  months_of_history: number
  totals: { spent: number; income: number; net: number }
  previous: { month: string; spent: number; income: number } | null
  categories: { category: string; cents: number; count: number; average_cents: number | null }[]
  top_merchants: { merchant: string; cents: number; count: number }[]
  budgets: { category: string; budget_cents: number; spent_cents: number }[]
  recurring: { merchant: string; amount_cents: number }[]
  flags: { kind: string; explanation: string }[]
}

/**
 * What the insight writer gets to see about a month: aggregates only. No descriptions, dates or
 * individual transactions leave the browser.
 */
export function summariseMonth(
  txns: TxnLike[],
  month: string,
  budgets: { category: string; amount_cents: number }[],
  flags: { kind: string; explanation: string }[],
): MonthSummary {
  const months = monthlyTotals(txns)
  const current = months.find((m) => m.month === month) ?? { month, spent: 0, income: 0, net: 0 }
  const previous = months.filter((m) => m.month < month).at(-1) ?? null
  const inMonth = txns.filter((t) => t.month === month)
  const byCategory = spendingByCategory(inMonth)
  const history = txns.filter((t) => t.month < month)
  const averages = new Map(monthlyAverages(history).map((a) => [a.category, a.average_cents]))

  // Grouped case-insensitively: the same shop can come back as "TechStore" and "Techstore".
  const merchants = new Map<string, { name: string; cents: number; count: number }>()
  for (const t of inMonth) {
    if (kindOf(t.category) !== 'expense' || !t.merchant) continue
    const key = t.merchant.trim().toLowerCase()
    const m = merchants.get(key) ?? { name: t.merchant.trim(), cents: 0, count: 0 }
    m.cents -= t.amount_cents
    m.count++
    merchants.set(key, m)
  }

  return {
    month,
    months_of_history: Math.max(months.filter((m) => m.month <= month).length, 1),
    totals: { spent: current.spent, income: current.income, net: current.net },
    previous: previous && { month: previous.month, spent: previous.spent, income: previous.income },
    categories: byCategory.map((c) => ({ ...c, average_cents: averages.get(c.category) ?? null })),
    top_merchants: [...merchants.values()]
      .map((v) => ({ merchant: v.name.slice(0, 80), cents: v.cents, count: v.count }))
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 15),
    budgets: budgets.map((b) => ({ category: b.category, budget_cents: b.amount_cents, spent_cents: byCategory.find((c) => c.category === b.category)?.cents ?? 0 })),
    recurring: detectRecurring(txns.filter((t) => t.month <= month))
      .filter((r) => r.status === 'confirmed')
      .slice(0, 30)
      .map((r) => ({ merchant: r.merchant.slice(0, 80), amount_cents: r.typical_amount_cents })),
    flags: flags.slice(0, 20).map((f) => ({ kind: f.kind.slice(0, 80), explanation: f.explanation.slice(0, 300) })),
  }
}

/**
 * The figures a summary's numbers come from (income, spending and each category's total) as one
 * comparable string. Saved with each summary; if it no longer matches, the summary is out of date.
 */
export function summaryBasis(s: MonthSummary): string {
  const categories = s.categories.map((c) => `${c.category}:${c.cents}`).sort().join('|')
  return `${s.totals.income}/${s.totals.spent}/${categories}`
}

/** Average monthly spending per category across the months present (for the categoriser's context). */
export function monthlyAverages(txns: TxnLike[]): { category: string; average_cents: number }[] {
  const months = new Set(txns.map((t) => t.month)).size || 1
  return spendingByCategory(txns).map((c) => ({ category: c.category, average_cents: Math.round(c.cents / months) }))
}
