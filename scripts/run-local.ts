// Runs one statement through the LOCAL pipeline the way the browser does (anonymous sign-in,
// upload, stream the trace) and, if an expected.json exists next to it, scores the result.
// Each run makes real Claude API calls (a few cents) and uses one upload from a fresh
// anonymous user's quota.
//
// Usage: node scripts/run-local.ts <statement.pdf|csv> [--quiet] [--context <context.json>]

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const [file, ...flags] = process.argv.slice(2)
const flag = flags.includes('--quiet') ? '--quiet' : undefined
const contextFile = flags.includes('--context') ? flags[flags.indexOf('--context') + 1] : undefined
if (!file) throw new Error('usage: node scripts/run-local.ts <statement.pdf|csv>')

const env = Object.fromEntries(
  execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m![1], m![2]]),
)
if (!env.API_URL?.startsWith('http://127.0.0.1')) throw new Error('local Supabase only')

const supabase = createClient(env.API_URL, env.PUBLISHABLE_KEY, { auth: { persistSession: false } })
// Cloudflare's Turnstile test token; only accepted because local config uses the test secret.
const { data: auth, error } = await supabase.auth.signInAnonymously({ options: { captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' } })
if (error) throw error

const form = new FormData()
form.append('file', new Blob([readFileSync(file)]), basename(file))
if (contextFile) form.append('context', readFileSync(contextFile, 'utf8'))
const started = Date.now()
const res = await fetch(`${env.FUNCTIONS_URL}/process-statement`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${auth.session!.access_token}` },
  body: form,
})
if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`)

type Txn = { date: string; amount_cents: number; balance_after_cents: number | null; description: string; merchant: string; category: string }
let result: { transactions: Txn[]; anomalies: { transaction_indexes: number[]; kind: string; explanation: string }[]; verification: { outcome: string; checks: { name: string; status: string; detail: string }[] }; summary: string; cost_usd: number } | undefined

let buffer = ''
const decoder = new TextDecoder()
for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
  buffer += decoder.decode(chunk, { stream: true })
  let nl
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = JSON.parse(buffer.slice(0, nl))
    buffer = buffer.slice(nl + 1)
    if (line.type === 'trace' && flag !== '--quiet') {
      const cost = line.cost_usd !== undefined ? `  $${line.cost_usd.toFixed(4)} (${line.input_tokens} in / ${line.output_tokens} out${line.cache_read_tokens ? `, ${line.cache_read_tokens} cached` : ''})` : ''
      console.log(`${(line.t / 1000).toFixed(1).padStart(6)}s  ${line.agent.padEnd(14)} ${line.kind.padEnd(11)} ${line.message}${cost}`)
    } else if (line.type === 'result') result = line
    else if (line.type === 'error') throw new Error(line.message)
  }
}
if (!result) throw new Error('stream ended without a result')

console.log(`\noutcome: ${result.verification.outcome} - ${result.summary}`)
for (const c of result.verification.checks) console.log(`  ${c.status.padEnd(7)} ${c.name}: ${c.detail}`)
for (const a of result.anomalies) console.log(`  flag    ${a.kind}: ${a.explanation} (rows ${a.transaction_indexes.join(', ')})`)
console.log(`transactions: ${result.transactions.length}, cost: $${result.cost_usd.toFixed(4)}, time: ${((Date.now() - started) / 1000).toFixed(1)}s`)

// Score against the known answer (synthetic fixtures only).
const expectedPath = file.replace(/\.(pdf|csv)$/i, '.expected.json')
if (existsSync(expectedPath)) {
  const expected: { transactions: { date: string; amount_cents: number; balance_after_cents: number; category?: string }[] } = JSON.parse(readFileSync(expectedPath, 'utf8'))
  const got = result.transactions
  let exact = 0
  expected.transactions.forEach((e, i) => {
    const g = got[i]
    if (g && g.date === e.date && g.amount_cents === e.amount_cents && g.balance_after_cents === e.balance_after_cents) exact++
  })
  console.log(`accuracy: ${exact}/${expected.transactions.length} transactions exactly right (date, signed amount, balance), extracted ${got.length}`)
  const wrong = expected.transactions
    .map((e, i) => ({ e, g: got[i] }))
    .filter(({ e, g }) => e.category && g && g.category !== e.category)
  console.log(`categories: ${expected.transactions.length - wrong.length}/${expected.transactions.length} match`)
  for (const { e, g } of wrong) console.log(`  expected ${e.category}, got ${g.category}: ${g.description} -> merchant "${g.merchant}"`)
}
