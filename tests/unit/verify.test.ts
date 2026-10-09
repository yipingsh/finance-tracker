import { describe, expect, it } from 'vitest'
import { parseCents } from '../../supabase/functions/process-statement/money'
import type { ExtractedTransaction, PageExtraction, StatementInfo } from '../../supabase/functions/process-statement/types'
import { normalise, resolveDate, verify } from '../../supabase/functions/process-statement/verify'

const noInfo: StatementInfo = {
  institution: null, account_type: null, account_last4: null, currency: null, period_start: null,
  period_end: null, opening_balance: null, closing_balance: null, total_debits: null, total_credits: null,
}

const tx = (day: number, amount: string, direction: 'debit' | 'credit', balance: string | null, month = 9): ExtractedTransaction => ({
  day, month, year: null, description: 'X', amount, direction, balance_after: balance, foreign_amount: null, foreign_currency: null,
})

const page = (transactions: ExtractedTransaction[], statement: Partial<StatementInfo> = {}, extra: Partial<PageExtraction> = {}): PageExtraction => ({
  page_type: 'transactions', statement: { ...noInfo, ...statement }, page_opening_balance: null, page_closing_balance: null, transactions, ...extra,
})

// A small bank statement shaped like the OCBC layout: opening balance, running balance on every
// row, printed totals, closing balance.
const header = { account_type: 'bank_account' as const, period_start: '2026-09-01', period_end: '2026-09-30', opening_balance: '99.12' }
const goodBank = () => [
  page([tx(1, '11.05', 'debit', '88.07'), tx(1, '1,000.04', 'credit', '1,088.11')], header),
  { ...page([]), page_type: 'other' as const }, // glossary page
  page([tx(2, '40.00', 'debit', '1,048.11'), tx(30, '0.13', 'credit', '1,048.24')], {
    ...header, closing_balance: '1,048.24', total_debits: '51.05', total_credits: '1,000.17',
  }),
]

describe('parseCents', () => {
  it('parses printed amounts into integer cents', () => {
    expect(parseCents('1,000.04')).toBe(100004)
    expect(parseCents('S$12.3')).toBe(1230)
    expect(parseCents('12.30 CR')).toBe(1230)
    expect(parseCents('(7)')).toBe(700)
    expect(parseCents('abc')).toBeNull()
  })
})

describe('resolveDate', () => {
  it('takes the year from the statement period', () => {
    expect(resolveDate(1, 9, null, '2026-09-30')).toBe('2026-09-01')
  })
  it('steps back a year for a December row on a January statement', () => {
    expect(resolveDate(28, 12, null, '2027-01-14')).toBe('2026-12-28')
  })
  it('rejects impossible dates', () => {
    expect(resolveDate(31, 9, 2026, null)).toBeNull()
  })
})

describe('verify', () => {
  it('verifies a statement whose numbers all reconcile', () => {
    const report = verify(normalise(goodBank()))
    expect(report.outcome).toBe('verified')
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([])
    expect(report.checks.find((c) => c.name === 'running_balance')?.status).toBe('pass')
    expect(report.checks.find((c) => c.name === 'totals')?.status).toBe('pass')
    expect(report.checks.find((c) => c.name === 'opening_to_closing')?.status).toBe('pass')
  })

  it('pinpoints the exact row when an extractor gets a withdrawal/deposit the wrong way round', () => {
    const pages = goodBank()
    pages[2].transactions[0].direction = 'credit' // the column mix-up plain text extraction would cause
    const report = verify(normalise(pages))
    expect(report.outcome).toBe('failed')
    expect(report.issues).toContainEqual(expect.objectContaining({ page: 3, row: 0 }))
  })

  it('catches a missed transaction through the totals even without running balances', () => {
    const pages = goodBank().map((p) => ({ ...p, transactions: p.transactions.map((t) => ({ ...t, balance_after: null })) }))
    pages[2].transactions.pop()
    const report = verify(normalise(pages))
    expect(report.checks.find((c) => c.name === 'running_balance')?.status).toBe('skipped')
    expect(report.checks.find((c) => c.name === 'totals')?.status).toBe('fail')
    expect(report.outcome).toBe('failed')
  })

  it('handles credit cards, where charges increase the balance', () => {
    const card = [page(
      [tx(3, '20.00', 'debit', '520.00'), tx(10, '500.00', 'credit', '20.00')],
      { account_type: 'credit_card', period_start: '2026-09-01', period_end: '2026-09-30', opening_balance: '500.00', closing_balance: '20.00' },
    )]
    const report = verify(normalise(card))
    expect(report.convention).toBe('card')
    expect(report.outcome).toBe('verified')
  })

  it('works out the convention from the numbers when the account type is unknown', () => {
    const card = [page([tx(3, '20.00', 'debit', '520.00'), tx(4, '5.00', 'debit', '525.00')], { opening_balance: '500.00' })]
    expect(verify(normalise(card)).convention).toBe('card')
  })

  it('accepts banks that print the balance only once per day', () => {
    const pages = [page([tx(1, '10.00', 'debit', null), tx(1, '5.00', 'debit', '85.00'), tx(2, '1.00', 'credit', '86.00')], { ...header, opening_balance: '100.00' })]
    expect(verify(normalise(pages)).checks.find((c) => c.name === 'running_balance')?.status).toBe('pass')
  })

  it('reports "unverified", not "verified", when the statement gives nothing to check against', () => {
    const exportFile = [page([tx(1, '10.00', 'debit', null)], { period_start: '2026-09-01', period_end: '2026-09-30' })]
    expect(verify(normalise(exportFile)).outcome).toBe('unverified')
  })

  it('flags dates outside the statement period', () => {
    const pages = goodBank()
    pages[0].transactions[0].month = 8
    const report = verify(normalise(pages))
    expect(report.checks.find((c) => c.name === 'dates_in_period')?.status).toBe('fail')
  })

  it('detects a break between pages when carried-forward balances disagree', () => {
    const pages = [
      page([tx(1, '1.00', 'debit', '99.00')], header, { page_opening_balance: '100.00', page_closing_balance: '99.00' }),
      page([tx(2, '1.00', 'debit', '97.00')], header, { page_opening_balance: '98.00', page_closing_balance: '97.00' }),
    ]
    const report = verify(normalise(pages))
    expect(report.checks.find((c) => c.name === 'page_continuity')?.status).toBe('fail')
  })

  it('keeps the sign of negative balances (an overdraft)', () => {
    const pages = [page([tx(1, '10.00', 'debit', '5.00'), tx(2, '8.12', 'debit', '-3.12'), tx(3, '20.00', 'credit', '16.88')], { ...header, opening_balance: '15.00' })]
    const report = verify(normalise(pages))
    expect(report.checks.find((c) => c.name === 'running_balance')?.status).toBe('pass')
  })

  it('masks full account numbers in descriptions, even if the extractor returned them', () => {
    const p = page([{ ...tx(1, '1,000.04', 'credit', null), description: 'FUND TRANSFER 987654321001 from own account' }], header)
    expect(normalise([p]).transactions[0].description).toBe('FUND TRANSFER xxxx1001 from own account')
  })

  it('fails when a page could not be extracted at all', () => {
    const pages = [...goodBank(), null]
    const report = verify(normalise(pages))
    expect(report.outcome).toBe('failed')
    expect(report.issues).toContainEqual(expect.objectContaining({ page: 4 }))
  })
})
