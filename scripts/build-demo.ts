// Builds the recruiter demo dataset: runs a few SYNTHETIC statements through the real local
// pipeline (so the traces, categories and flags are genuine agent output), writes a monthly
// summary for the latest month, and saves everything to public/demo/demo-data.json.
// The demo never contains anyone's real data.
//
// Costs ~US$0.30 in API calls. Raises the LOCAL global daily cap while it runs (like the evals).
// Usage: node scripts/build-demo.ts

import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { detectRecurring, monthlyAverages, summariseMonth, type TxnLike } from '../src/lib/analytics.ts'

const STATEMENTS = ['bank-a-jul', 'bank-a-aug', 'bank-a-sep', 'card-sep']
const BUDGETS = [
  { category: 'Food & Drink', amount_cents: 18000 },
  { category: 'Transport', amount_cents: 6000 },
  { category: 'Shopping', amount_cents: 15000 },
]

const env = Object.fromEntries(
  execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m![1], m![2]]),
)
if (!env.API_URL?.startsWith('http://127.0.0.1')) throw new Error('local Supabase only')

const db = new pg.Pool({ connectionString: env.DB_URL })
const { rows: capRows } = await db.query('select global_daily_cap_usd from private.limits')
await db.query('update private.limits set global_daily_cap_usd = 1000')
const restoreCap = async () => {
  await db.query('update private.limits set global_daily_cap_usd = $1', [capRows[0].global_daily_cap_usd])
  await db.end()
}

try {
// A fresh anonymous user every 3 statements, because of the 3-uploads-a-month limit.
const UPLOADS_PER_USER = 3
async function newToken(): Promise<string> {
  const supabase = createClient(env.API_URL, env.PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const { data: auth, error } = await supabase.auth.signInAnonymously({ options: { captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' } })
  if (error) throw error
  return auth.session!.access_token
}
let token = await newToken()
let uploadsWithToken = 0

type Txn = TxnLike & { date: string; description: string; source: string }
type Result = { transactions: Txn[]; anomalies: { kind: string; explanation: string; transaction_indexes: number[] }[]; cost_usd: number; summary: string }
const runs: { file_name: string; file_sha256: string; result: Result; events: unknown[] }[] = []
const history: TxnLike[] = []
// The demo tells the "learns from your corrections" story honestly: after the first statement,
// the visitor-persona recategorises SampleFin (their investment app) once, exactly as a user would
// in the Transactions tab. Later statements go through the real pipeline with that rule applied.
const rules: { key: string; merchant: string; direction: 'in' | 'out'; category: string }[] = []

for (const name of STATEMENTS) {
  const file = readFileSync(`evals/fixtures/${name}.pdf`)
  // Context exactly as the browser would build it from what's been "uploaded" so far.
  const context = {
    merchant_rules: rules.map(({ merchant, direction, category }) => ({ merchant, direction, category })),
    recurring: detectRecurring(history).filter((r) => r.status === 'confirmed').map((r) => ({ merchant: r.merchant, typical_amount_cents: r.typical_amount_cents, months_seen: r.months_seen })),
    monthly_averages: monthlyAverages(history),
  }
  const form = new FormData()
  form.append('file', new Blob([file]), `${name}.pdf`)
  form.append('context', JSON.stringify(context))
  if (uploadsWithToken >= UPLOADS_PER_USER) {
    token = await newToken()
    uploadsWithToken = 0
  }
  uploadsWithToken++
  const res = await fetch(`${env.FUNCTIONS_URL}/process-statement`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  if (!res.ok || !res.body) throw new Error(`${name}: HTTP ${res.status} ${await res.text()}`)

  const events: unknown[] = []
  let result: Result | undefined
  let buffer = ''
  const decoder = new TextDecoder()
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = JSON.parse(buffer.slice(0, nl))
      buffer = buffer.slice(nl + 1)
      if (line.type === 'trace') events.push(line)
      if (line.type === 'result') result = line
      if (line.type === 'error') throw new Error(`${name}: ${line.message}`)
    }
  }
  if (!result) throw new Error(`${name}: no result`)
  if (rules.length === 0) {
    // The correction a user would make the first time SampleFin shows up.
    const fin = result.transactions.find((t) => /samplefin/i.test(t.description) && t.amount_cents < 0)
    if (fin) {
      rules.push({ key: `${fin.merchant.trim().toLowerCase()}|out`, merchant: fin.merchant, direction: 'out', category: 'Investments & Savings' })
      for (const t of result.transactions) {
        if (t.merchant.trim().toLowerCase() === fin.merchant.trim().toLowerCase() && t.amount_cents < 0) {
          t.category = 'Investments & Savings'
          t.source = 'user_rule'
        }
      }
      console.log(`rule added after first statement: ${fin.merchant} -> Investments & Savings`)
    }
  }
  runs.push({ file_name: `${name}.pdf`, file_sha256: createHash('sha256').update(file).digest('hex'), result, events })
  history.push(...result.transactions.map((t) => ({ ...t, month: t.date.slice(0, 7) })))
  console.log(`${name}: ${result.transactions.length} transactions, ${result.anomalies.length} flags, $${result.cost_usd.toFixed(3)} - ${result.summary}`)
}

// Monthly summary for the latest month, from the same aggregates the browser would send.
const month = history.map((t) => t.month).sort().at(-1)!
const flags = runs.flatMap((r) => r.result.anomalies.filter((a) => a.transaction_indexes.some((i) => r.result.transactions[i]?.date.startsWith(month))))
const summary = summariseMonth(history, month, BUDGETS, flags)
const res = await fetch(`${env.FUNCTIONS_URL}/generate-insights`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(summary),
})
const body = await res.json()
if (!res.ok) throw new Error(`insight: ${JSON.stringify(body)}`)
console.log(`insight for ${month}: $${body.cost_usd.toFixed(3)} - ${body.insight.headline}`)

// Costs are for the app owner (Claude Console), not visitors: keep them out of the public file.
const noCost = <T extends object>(o: T) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'cost_usd' ? undefined : v)))
mkdirSync('public/demo', { recursive: true })
writeFileSync('public/demo/demo-data.json', JSON.stringify({
  note: 'Synthetic sample data for the demo. Made-up statements; not anyone\'s real finances.',
  generated_at: new Date().toISOString(),
  runs: noCost(runs),
  budgets: BUDGETS,
  merchant_rules: rules,
  insights: [{ month, ...body.insight, generated_at: new Date().toISOString(), model: body.model }],
}))
console.log('wrote public/demo/demo-data.json')
} finally {
  await restoreCap()
}
