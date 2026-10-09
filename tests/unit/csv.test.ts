import { describe, expect, it } from 'vitest'
import { applyMapping, parseCsv, parseDate, type CsvMapping } from '../../supabase/functions/process-statement/csvParse'

describe('parseCsv', () => {
  it('handles quoted fields with commas, escaped quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']])
  })
})

describe('parseDate', () => {
  it('reads every supported format', () => {
    expect(parseDate('2026-09-03', 'YYYY-MM-DD')).toEqual({ day: 3, month: 9, year: 2026 })
    expect(parseDate('03/09/2026', 'DD/MM/YYYY')).toEqual({ day: 3, month: 9, year: 2026 })
    expect(parseDate('09/03/2026', 'MM/DD/YYYY')).toEqual({ day: 3, month: 9, year: 2026 })
    expect(parseDate('03-Sep-2026', 'DD-Mon-YYYY')).toEqual({ day: 3, month: 9, year: 2026 })
    expect(parseDate('Sep 3, 2026', 'Mon DD, YYYY')).toEqual({ day: 3, month: 9, year: 2026 })
  })
  it('rejects impossible dates instead of rolling them over', () => {
    expect(parseDate('31/09/2026', 'DD/MM/YYYY')).toBeNull()
  })
})

describe('applyMapping', () => {
  const signed: CsvMapping = {
    has_header: true, date_column: 0, date_format: 'YYYY-MM-DD', description_columns: [1], amount_mode: 'signed',
    amount_column: 2, negative_means: 'money_out', debit_column: null, credit_column: null, balance_column: 3,
  }

  it('parses signed amounts and balances exactly', () => {
    const rows = parseCsv('Date,Description,Amount,Balance\n2026-09-01,"STEAM, GAMES",-21.53,"1,078.47"\n2026-09-02,Top up,200,1278.47\n')
    const { transactions, unparseable } = applyMapping(rows, signed)
    expect(unparseable).toBe(0)
    expect(transactions).toEqual([
      expect.objectContaining({ day: 1, month: 9, year: 2026, description: 'STEAM, GAMES', amount: '21.53', direction: 'debit', balance_after: '1,078.47' }),
      expect.objectContaining({ amount: '200.00', direction: 'credit', balance_after: '1,278.47' }),
    ])
  })

  it('handles separate debit and credit columns', () => {
    const map: CsvMapping = { ...signed, amount_mode: 'separate_debit_credit', amount_column: null, debit_column: 2, credit_column: 3, balance_column: null }
    const rows = parseCsv('Date,Desc,Debit,Credit\n2026-09-01,Shop,12.30,\n2026-09-02,Salary,,3000.00\n')
    expect(applyMapping(rows, map).transactions.map((t) => [t.amount, t.direction])).toEqual([['12.30', 'debit'], ['3,000.00', 'credit']])
  })

  it('counts rows that do not fit the mapping, so a wrong mapping is detected', () => {
    const rows = parseCsv('Date,Description,Amount,Balance\n03/09/2026,Shop,-5,10\nTotal,,,\n')
    expect(applyMapping(rows, signed).unparseable).toBe(2)
  })
})
