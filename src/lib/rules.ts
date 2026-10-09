// Account-reference rules: "every transfer from account …1001 is Income".
//
// Some people are paid into one account and move the money to the one they spend from. The
// statement only says "FUND TRANSFER …1001 from own account", so a merchant rule can't tell that
// transfer apart from other own-account transfers, but the account's last 4 digits can.
// The extractor masks account numbers (e.g. "xxxx1001"), so rules match on the last 4 digits of an
// account-like number, masked or in full. They run in the browser after each upload.
// Pure functions, no database, so they're unit-tested directly.

export interface ReferenceRule {
  /** `${last4}|${direction}` */
  key: string
  /** Last 4 digits of the account, e.g. "1001" */
  reference: string
  direction: 'in' | 'out'
  category: string
}

/**
 * Account numbers mentioned in a description, as their last 4 digits: a masked number like
 * "xxxx1001" / "****1001" / "••••1001", or a full one of 9+ digits. Card endings written "xx-1852",
 * 8-digit NETS terminal ids and dates don't match.
 */
export function accountEndings(description: string): string[] {
  const out = new Set<string>()
  for (const m of description.matchAll(/(?:[x*•]{2,}|\d{5,})(\d{4})(?!\d)/gi)) out.add(m[1])
  return [...out]
}

export const accountReference = (description: string): string | null => accountEndings(description)[0] ?? null

export const mentionsAccount = (description: string, last4: string) => accountEndings(description).includes(last4)

type Categorisable = { description: string; amount_cents: number; category: string; category_source: string; confidence: string }

/** Apply reference rules to transactions; returns new objects only for those that change. */
export function applyReferenceRules<T extends Categorisable>(txns: T[], rules: ReferenceRule[]): T[] {
  if (rules.length === 0) return txns
  return txns.map((t) => {
    const dir = t.amount_cents < 0 ? 'out' : 'in'
    const rule = rules.find((r) => r.direction === dir && mentionsAccount(t.description, r.reference))
    return rule && t.category !== rule.category ? { ...t, category: rule.category, category_source: 'user_rule', confidence: 'high' } : t
  })
}
