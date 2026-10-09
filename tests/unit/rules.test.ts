import { describe, expect, it } from 'vitest'
import { accountReference, applyReferenceRules, type ReferenceRule } from '../../src/lib/rules'

const t = (description: string, amount_cents: number, category: string) => ({ description, amount_cents, category, category_source: 'agent', confidence: 'high' })

describe('accountReference', () => {
  it('finds the last 4 digits of a masked account number (how the extractor returns them)', () => {
    expect(accountReference('FUND TRANSFER xxxx1001 from own account OTHR - Other')).toBe('1001')
    expect(accountReference('FUND TRANSFER ****1001 from own account')).toBe('1001')
  })
  it('also handles a full account number', () => {
    expect(accountReference('FUND TRANSFER 987654321001 from own account')).toBe('1001')
  })
  it('ignores card endings, NETS terminal ids and dates', () => {
    expect(accountReference('DEBIT PURCHASE 29/08/26 xx-1852 Grab*')).toBeNull()
    expect(accountReference('NETS QR PURCHASE MINI FRY 3762696')).toBeNull()
  })
})

describe('applyReferenceRules', () => {
  const rules: ReferenceRule[] = [{ key: '1001|in', reference: '1001', direction: 'in', category: 'Income' }]

  it('re-categorises only transfers from that account, in that direction', () => {
    const out = applyReferenceRules([
      t('FUND TRANSFER xxxx1001 from own account', 100004, 'Own-account transfers'),
      t('FUND TRANSFER xxxx7777 from own account', 20000, 'Own-account transfers'),
      t('FUND TRANSFER xxxx1001 to own account', -5000, 'Own-account transfers'),
    ], rules)
    expect(out.map((x) => x.category)).toEqual(['Income', 'Own-account transfers', 'Own-account transfers'])
    expect(out[0].category_source).toBe('user_rule')
  })

  it('matches whether the statement masks the number or prints it in full', () => {
    const out = applyReferenceRules([t('FUND TRANSFER 987654321001 from own account', 100004, 'Own-account transfers')], rules)
    expect(out[0].category).toBe('Income')
  })

  it('leaves everything alone when there are no rules', () => {
    const txns = [t('FUND TRANSFER xxxx1001 from own account', 100004, 'Own-account transfers')]
    expect(applyReferenceRules(txns, [])).toBe(txns)
  })
})
