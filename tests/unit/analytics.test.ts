import { describe, expect, it } from 'vitest'
import { detectRecurring, monthlyTotals, spendingByCategory, summariseMonth, type TxnLike } from '../../src/lib/analytics'

describe('summariseMonth', () => {
  const txns = [
    { date: '2026-08-05', month: '2026-08', merchant: 'Kopi', category: 'Food & Drink', amount_cents: -1000 },
    { date: '2026-09-05', month: '2026-09', merchant: 'Kopi', category: 'Food & Drink', amount_cents: -1500 },
    { date: '2026-09-06', month: '2026-09', merchant: 'Employer', category: 'Income', amount_cents: 200000 },
  ]
  it('sends only aggregates, with averages taken from earlier months', () => {
    const s = summariseMonth(txns, '2026-09', [{ category: 'Food & Drink', amount_cents: 1200 }], [])
    expect(s.totals).toEqual({ spent: 1500, income: 200000, net: 198500 })
    expect(s.previous).toEqual({ month: '2026-08', spent: 1000, income: 0 })
    expect(s.categories).toEqual([{ category: 'Food & Drink', cents: 1500, count: 1, average_cents: 1000 }])
    expect(s.budgets).toEqual([{ category: 'Food & Drink', budget_cents: 1200, spent_cents: 1500 }])
    expect(s.months_of_history).toBe(2)
    expect(JSON.stringify(s)).not.toContain('2026-09-05') // no individual transaction dates
  })
})

const t = (date: string, merchant: string, category: string, amount_cents: number): TxnLike => ({
  date, month: date.slice(0, 7), merchant, category, amount_cents,
})

describe('monthlyTotals', () => {
  it('counts spending and income but not transfers between own accounts', () => {
    const [sep] = monthlyTotals([
      t('2026-09-01', 'Kopi', 'Food & Drink', -450),
      t('2026-09-02', 'Employer', 'Income', 300000),
      t('2026-09-03', 'Own account', 'Own-account transfers', 100000),
      t('2026-09-04', 'SampleFin', 'Investments & Savings', -5000),
    ])
    expect(sep).toEqual({ month: '2026-09', spent: 450, income: 300000, net: 299550 })
  })
})

describe('spendingByCategory', () => {
  it('sums spending per category, largest first, and ignores income', () => {
    const rows = spendingByCategory([
      t('2026-09-01', 'A', 'Transport', -300),
      t('2026-09-02', 'B', 'Food & Drink', -1000),
      t('2026-09-03', 'C', 'Food & Drink', -500),
      t('2026-09-04', 'D', 'Interest', 13),
    ])
    expect(rows).toEqual([
      { category: 'Food & Drink', cents: 1500, count: 2 },
      { category: 'Transport', cents: 300, count: 1 },
    ])
  })
})

describe('detectRecurring', () => {
  it('finds a monthly charge at a steady amount', () => {
    const r = detectRecurring([
      t('2026-07-05', 'Streamflix', 'Subscriptions', -1598),
      t('2026-08-05', 'Streamflix', 'Subscriptions', -1598),
      t('2026-09-05', 'Streamflix', 'Subscriptions', -1698),
    ])
    expect(r).toEqual([expect.objectContaining({ merchant: 'Streamflix', status: 'confirmed', months_seen: 3, next_expected: '2026-10-05' })])
  })

  it('does not treat everyday spending as a subscription', () => {
    const coffee = Array.from({ length: 20 }, (_, i) => t(`2026-0${8 + (i % 2)}-${String(1 + i).padStart(2, '0')}`, 'Kopi', 'Food & Drink', -450))
    expect(detectRecurring(coffee)).toEqual([])
  })

  it('ignores a shop visited once a month at different times and amounts', () => {
    expect(detectRecurring([
      t('2026-08-03', 'Sample Mart', 'Groceries', -2410),
      t('2026-09-21', 'Sample Mart', 'Groceries', -2560),
      t('2026-08-10', 'Drinks Stall', 'Food & Drink', -650),
      t('2026-09-12', 'Drinks Stall', 'Food & Drink', -710),
    ])).toEqual([])
  })

  it('allows a utility bill to vary in amount if it arrives around the same day', () => {
    const r = detectRecurring([
      t('2026-08-15', 'SP Group', 'Bills & Utilities', -8200),
      t('2026-09-14', 'SP Group', 'Bills & Utilities', -9650),
    ])
    expect(r[0]).toEqual(expect.objectContaining({ merchant: 'SP Group', status: 'confirmed' }))
  })

  it('ignores an occasional extra charge when finding the monthly pattern', () => {
    const r = detectRecurring([
      t('2026-08-07', 'CloudStore', 'Subscriptions', -399),
      t('2026-09-02', 'CloudStore', 'Subscriptions', -399),
      t('2026-09-20', 'CloudStore', 'Subscriptions', -399),
    ])
    expect(r[0]).toEqual(expect.objectContaining({ merchant: 'CloudStore', status: 'confirmed', months_seen: 2 }))
  })

  it('ignores a fixed-price payment that lands on unrelated days', () => {
    expect(detectRecurring([
      t('2026-08-02', 'Gym', 'Health', -5000),
      t('2026-09-20', 'Gym', 'Health', -5000),
    ])).toEqual([])
  })

  it('marks a subscription seen only once as possible', () => {
    expect(detectRecurring([t('2026-09-10', 'CloudStore', 'Subscriptions', -399)])[0].status).toBe('possible')
  })
})
