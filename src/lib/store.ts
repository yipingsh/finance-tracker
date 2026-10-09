import { CATEGORY_NAMES } from '../../supabase/functions/_shared/categories'
import { detectRecurring, monthlyAverages } from './analytics'
import { db, direction, ruleKey, stripCost, type Account, type Anomaly, type Run, type Statement, type Txn } from './db'
import type { CategoriserContext, RunResult, TraceEvent } from './processStatement'
import { accountReference, applyReferenceRules, mentionsAccount } from './rules'

export async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function alreadyUploaded(hash: string): Promise<Statement | undefined> {
  return db.statements.where('file_sha256').equals(hash).first()
}

/**
 * What the categoriser gets to know about this user: their corrections, their recurring
 * merchants and typical monthly spend per category. Summaries only, never raw history.
 */
export async function buildContext(): Promise<CategoriserContext> {
  const [rules, txns] = await Promise.all([db.merchantRules.toArray(), db.transactions.toArray()])
  const known = new Set<string>(CATEGORY_NAMES)
  return {
    merchant_rules: rules
      .filter((r) => known.has(r.category))
      .slice(0, 500)
      .map((r) => ({ merchant: r.merchant.slice(0, 80), direction: r.direction, category: r.category })),
    recurring: detectRecurring(txns)
      .filter((r) => r.status === 'confirmed')
      .slice(0, 100)
      .map((r) => ({ merchant: r.merchant.slice(0, 80), typical_amount_cents: r.typical_amount_cents, months_seen: r.months_seen })),
    monthly_averages: monthlyAverages(txns).filter((a) => known.has(a.category)),
  }
}

/** Saves a finished run. Re-uploading a statement for the same account and period replaces it. */
export async function saveResult(result: RunResult, file: { name: string; sha256: string }, events: TraceEvent[]): Promise<string> {
  const s = result.statement
  const accountId = ['acct', s.institution, s.account_type, s.account_last4].map((v) => (v ?? '').toLowerCase()).join('|')
  const statementId = crypto.randomUUID()

  const mapped: Txn[] = result.transactions.map((t) => ({
    id: crypto.randomUUID(),
    statement_id: statementId,
    account_id: accountId,
    date: t.date,
    month: t.date.slice(0, 7),
    description: t.description,
    merchant: t.merchant,
    category: t.category,
    category_source: t.source,
    confidence: t.confidence,
    amount_cents: t.amount_cents,
    balance_after_cents: t.balance_after_cents,
    foreign_amount: t.foreign_amount,
    foreign_currency: t.foreign_currency,
    page: t.page,
    row: t.row,
  }))
  // Account-reference rules run here, in the browser, so account numbers never leave it.
  const txns = applyReferenceRules(mapped, await db.referenceRules.toArray())
  const anomalies: Anomaly[] = result.anomalies.map((a) => ({
    id: crypto.randomUUID(),
    statement_id: statementId,
    transaction_ids: a.transaction_indexes.map((i) => txns[i]?.id).filter(Boolean),
    kind: a.kind,
    explanation: a.explanation,
    status: 'open',
  }))
  const account: Account = { id: accountId, institution: s.institution, account_type: s.account_type, last4: s.account_last4, currency: s.currency }
  const statement: Statement = {
    id: statementId,
    account_id: accountId,
    file_name: file.name,
    file_sha256: file.sha256,
    period_start: s.period_start,
    period_end: s.period_end,
    outcome: result.verification.outcome,
    checks: result.verification.checks,
    summary: result.summary,
    uploaded_at: new Date().toISOString(),
  }
  const run: Run = { id: result.run_id, statement_id: statementId, events: events.map(stripCost) }

  await db.transaction('rw', [db.accounts, db.statements, db.transactions, db.anomalies, db.runs], async () => {
    const previous = await db.statements
      .where('account_id').equals(accountId)
      .filter((p) => p.period_start === s.period_start && p.period_end === s.period_end)
      .toArray()
    for (const p of previous) await deleteStatementData(p.id)
    await db.accounts.put(account)
    await db.statements.add(statement)
    await db.transactions.bulkAdd(txns)
    await db.anomalies.bulkAdd(anomalies)
    await db.runs.put(run)
  })
  return statementId
}

async function deleteStatementData(statementId: string) {
  await db.transactions.where('statement_id').equals(statementId).delete()
  await db.anomalies.where('statement_id').equals(statementId).delete()
  await db.runs.where('statement_id').equals(statementId).delete()
  await db.statements.delete(statementId)
}

export async function deleteStatement(statementId: string) {
  await db.transaction('rw', [db.statements, db.transactions, db.anomalies, db.runs], () => deleteStatementData(statementId))
}

/** Change the category of just this one transaction. No rule is saved. */
export async function recategoriseOne(txn: Txn, category: string): Promise<void> {
  await db.transactions.update(txn.id, { category, category_source: 'user', confidence: 'high' })
}

/** Other transactions with the same merchant and direction that aren't in this category yet. */
export async function similarTransactions(txn: Txn, category: string): Promise<Txn[]> {
  if (!txn.merchant) return []
  const key = ruleKey(txn.merchant, txn.amount_cents)
  return db.transactions.filter((t) => t.id !== txn.id && ruleKey(t.merchant, t.amount_cents) === key && t.category !== category).toArray()
}

/**
 * Only when the user asks for it: move every transaction with the same merchant in the same
 * direction, and save a rule that the categoriser applies to future uploads.
 */
export async function applyToAllFromMerchant(txn: Txn, category: string): Promise<number> {
  const merchant = txn.merchant || txn.description
  const key = ruleKey(merchant, txn.amount_cents)
  return db.transaction('rw', [db.transactions, db.merchantRules], async () => {
    await db.merchantRules.put({ key, merchant, direction: direction(txn.amount_cents), category })
    const same = await db.transactions.filter((t) => ruleKey(t.merchant || t.description, t.amount_cents) === key).toArray()
    await db.transactions.bulkPut(same.map((t) => ({ ...t, category, category_source: 'user' as const, confidence: 'high' as const })))
    return same.length
  })
}

/**
 * Every transfer whose description mentions this transaction's account number (e.g. from …1001),
 * in the same direction, goes to this category, now and on future uploads.
 */
export async function applyToAccount(txn: Txn, category: string): Promise<number> {
  const reference = accountReference(txn.description)
  if (!reference) return 0
  const direction: 'in' | 'out' = txn.amount_cents < 0 ? 'out' : 'in'
  return db.transaction('rw', [db.transactions, db.referenceRules], async () => {
    const rule = { key: `${reference}|${direction}`, reference, direction, category }
    await db.referenceRules.put(rule)
    const all = await db.transactions.toArray()
    const covered = all.filter((t) => (t.amount_cents < 0 ? 'out' : 'in') === direction && mentionsAccount(t.description, reference))
    await db.transactions.bulkPut(covered.map((t) => ({ ...t, category, category_source: 'user_rule' as const, confidence: 'high' as const })))
    return covered.length
  })
}

// ---- Backup: the only copy of the data is in this browser, so let the user keep one ----

const TABLES = ['accounts', 'statements', 'transactions', 'anomalies', 'budgets', 'merchantRules', 'runs', 'insights', 'referenceRules'] as const

export async function exportBackup(): Promise<Blob> {
  const data: Record<string, unknown[]> = {}
  for (const name of TABLES) data[name] = await db.table(name).toArray()
  return new Blob([JSON.stringify({ app: 'finance-tracker', version: 1, exported_at: new Date().toISOString(), data })], { type: 'application/json' })
}

export async function importBackup(file: File): Promise<void> {
  const parsed = JSON.parse(await file.text())
  if (parsed?.app !== 'finance-tracker' || parsed.version !== 1 || typeof parsed.data !== 'object' || parsed.data === null) {
    throw new Error("This isn't a Finance Tracker backup file.")
  }
  await db.transaction('rw', TABLES.map((n) => db.table(n)), async () => {
    for (const name of TABLES) {
      // Older backups have no insights or reference rules yet.
      const rows = parsed.data[name] ?? (name === 'insights' || name === 'referenceRules' ? [] : undefined)
      if (!Array.isArray(rows)) throw new Error(`Backup is missing ${name}.`)
      await db.table(name).clear()
      await db.table(name).bulkAdd(rows)
    }
  })
}
