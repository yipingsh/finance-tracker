import Dexie, { type EntityTable } from 'dexie'
import type { Check, TraceEvent } from './processStatement'
import { maskAccountNumbers } from '../../supabase/functions/process-statement/mask.ts'
import type { ReferenceRule } from './rules'

// Everything financial lives here, in this browser's IndexedDB. Nothing is sent back to a server.

export interface Account {
  id: string
  institution: string | null
  account_type: string | null
  last4: string | null
  currency: string | null
}

export interface Statement {
  id: string
  account_id: string
  file_name: string
  /** SHA-256 of the uploaded file, so the same file can't be processed (and charged) twice. */
  file_sha256: string
  period_start: string | null
  period_end: string | null
  outcome: 'verified' | 'unverified' | 'failed'
  checks: Check[]
  summary: string
  uploaded_at: string
}

export interface Txn {
  id: string
  statement_id: string
  account_id: string
  date: string
  /** YYYY-MM, indexed for monthly views */
  month: string
  description: string
  merchant: string
  category: string
  category_source: 'agent' | 'user_rule' | 'user' | 'fallback'
  confidence: 'high' | 'medium' | 'low'
  amount_cents: number
  balance_after_cents: number | null
  foreign_amount: string | null
  foreign_currency: string | null
  page: number
  row: number
}

export interface Anomaly {
  id: string
  statement_id: string
  transaction_ids: string[]
  kind: string
  explanation: string
  status: 'open' | 'dismissed'
}

export interface Budget {
  category: string
  amount_cents: number
}

/** A user correction: money to/from this merchant always belongs in this category. Sent to the categoriser. */
export interface MerchantRule {
  key: string
  merchant: string
  direction: 'in' | 'out'
  category: string
}

export interface Insight {
  month: string
  headline: string
  observations: string[]
  suggestions: string[]
  generated_at: string
  model: string
}

export interface Run {
  id: string
  statement_id: string
  events: TraceEvent[]
}

type FinanceDb = Dexie & {
  accounts: EntityTable<Account, 'id'>
  statements: EntityTable<Statement, 'id'>
  transactions: EntityTable<Txn, 'id'>
  anomalies: EntityTable<Anomaly, 'id'>
  budgets: EntityTable<Budget, 'category'>
  merchantRules: EntityTable<MerchantRule, 'key'>
  runs: EntityTable<Run, 'id'>
  insights: EntityTable<Insight, 'month'>
  referenceRules: EntityTable<ReferenceRule, 'key'>
}

/** Trace events arrive with a cost per model call; the browser doesn't keep it. */
export function stripCost<T extends { cost_usd?: number }>(event: T): Omit<T, 'cost_usd'> {
  const { cost_usd: _cost, ...rest } = event
  void _cost
  return rest
}

function open(name: string): FinanceDb {
  const d = new Dexie(name) as FinanceDb
  d.version(1).stores({
    accounts: 'id',
    statements: 'id, account_id, file_sha256, period_start',
    transactions: 'id, statement_id, account_id, month, date, category, merchant',
    anomalies: 'id, statement_id, status',
    budgets: 'category',
    merchantRules: 'key',
    runs: 'id, statement_id',
  })
  d.version(2).stores({ insights: 'month' })
  // v3: processing costs are no longer kept in the browser (they're only useful to the app's
  // owner, who sees them in the Claude Console). Strip them from anything saved earlier.
  d.version(3).stores({}).upgrade(async (tx) => {
    await tx.table('statements').toCollection().modify((s) => { delete s.cost_usd })
    await tx.table('insights').toCollection().modify((i) => { delete i.cost_usd })
    await tx.table('runs').toCollection().modify((r) => {
      delete r.cost_usd
      r.events = (r.events ?? []).map(stripCost)
    })
  })
  // v4: account-reference rules ("transfers from …1001 are Income"), kept only in this browser
  d.version(4).stores({ referenceRules: 'key' })
  // v5: mask full account numbers in descriptions saved before masking moved into code.
  d.version(5).stores({}).upgrade((tx) =>
    tx.table('transactions').toCollection().modify((t) => {
      t.description = maskAccountNumbers(t.description)
    }),
  )
  return d
}

// The demo lives in its own database, so sample data can never mix with a user's real data.
export type Mode = 'real' | 'demo'
const MODE_KEY = 'finance-tracker-mode'
const dbName = (mode: Mode) => (mode === 'demo' ? 'finance-tracker-demo' : 'finance-tracker')

export function savedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'real'
  } catch {
    return 'real'
  }
}

/** Live binding: modules importing `db` see the switch. Remount views after switching. */
export let db: FinanceDb = open(dbName(savedMode()))

export function switchDatabase(mode: Mode) {
  db.close()
  db = open(dbName(mode))
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // private mode etc.: the switch still works for this page view
  }
}

export const direction = (amountCents: number): 'in' | 'out' => (amountCents < 0 ? 'out' : 'in')

/** Rules are per merchant AND direction: paying Alex and being paid by Alex are different categories. */
export const ruleKey = (merchant: string, amountCents: number) => `${merchant.trim().toLowerCase()}|${direction(amountCents)}`
