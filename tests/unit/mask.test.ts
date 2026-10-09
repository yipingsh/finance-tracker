import { describe, expect, it } from 'vitest'
import { maskAccountNumbers } from '../../supabase/functions/process-statement/mask'
import { accountReference } from '../../src/lib/rules'

describe('maskAccountNumbers', () => {
  it('keeps only the last 4 digits of an account number', () => {
    expect(maskAccountNumbers('FUND TRANSFER 987654321001 from own account')).toBe('FUND TRANSFER xxxx1001 from own account')
  })
  it('handles card numbers split by spaces or dashes', () => {
    expect(maskAccountNumbers('CARD 5555 1234 5678 9012 payment')).toBe('CARD xxxx9012 payment')
    expect(maskAccountNumbers('ACC 123-456789-001')).toBe('ACC xxxx9001')
  })
  it('leaves amounts, dates, card endings and short ids alone', () => {
    const text = 'DEBIT PURCHASE 29/08/26 xx-1852 GRAB 1,000.04 NETS 37626963'
    expect(maskAccountNumbers(text)).toBe(text)
  })
  it('keeps working with the "transfers from …1001" rule', () => {
    expect(accountReference(maskAccountNumbers('FUND TRANSFER 987654321001 from own account'))).toBe('1001')
  })
})
