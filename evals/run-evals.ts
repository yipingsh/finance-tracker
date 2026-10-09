// Eval suite: runs every synthetic statement in evals/fixtures through the LOCAL pipeline and
// scores the result against its known-correct answer.
//
// Each statement makes real Claude API calls (~US$0.06). The script raises the LOCAL global
// daily cap while it runs and restores it afterwards; it refuses to run against anything but
// local Supabase.
//
// Usage: node evals/run-evals.ts [--only <name-prefix>] [--concurrency 3] [--resume [--rerun csv,card]]
//   --resume keeps the successful statements from the most recent results file and runs the rest;
//   --rerun names prefixes to run again anyway (e.g. after changing that part of the pipeline).
//
// Don't build, lint or edit function files while it runs: the local function server restarts on
// file events and drops in-flight requests.

import { execSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : ''
const concurrency = args.includes('--concurrency') ? Number(args[args.indexOf('--concurrency') + 1]) : 3
const resume = args.includes('--resume')
/** With --resume: statements to run again even if they finished last time (e.g. after a pipeline change). */
const rerun = args.includes('--rerun') ? args[args.indexOf('--rerun') + 1].split(',') : []
const FIXTURES = 'evals/fixtures'

const env = Object.fromEntries(
  execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m![1], m![2]]),
)
if (!env.API_URL?.startsWith('http://127.0.0.1')) throw new Error('evals only run against local Supabase')

type Expected = {
  layout: string
  expected_outcome: string
  transactions: { date: string; amount_cents: number; balance_after_cents: number | null; category: string }[]
  injected_duplicates: number[][]
}
type Result = {
  transactions: { date: string; amount_cents: number; balance_after_cents: number | null; category: string }[]
  anomalies: { transaction_indexes: number[]; kind: string }[]
  verification: { outcome: string }
  cost_usd: number
}

const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.expected.json') && f.startsWith(only))
  .map((f) => f.replace('.expected.json', ''))
  .sort()
const fileFor = (name: string) => readdirSync(FIXTURES).find((f) => f.startsWith(name + '.') && !f.endsWith('.json'))!

// ---- Users: one run at a time per user and 3 uploads a month, so each worker rotates users ----
const CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX' // Cloudflare test token, accepted only by the local test secret
async function newSession() {
  const client = createClient(env.API_URL, env.PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInAnonymously({ options: { captchaToken: CAPTCHA } })
  if (error) throw error
  return { token: data.session!.access_token, uploads: 0 }
}

async function runOne(name: string, session: { token: string }): Promise<{ result: Result; seconds: number }> {
  const form = new FormData()
  const file = fileFor(name)
  form.append('file', new Blob([readFileSync(`${FIXTURES}/${file}`)]), file)
  const started = Date.now()
  const res = await fetch(`${env.FUNCTIONS_URL}/process-statement`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: form })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  let buffer = ''
  let result: Result | undefined
  const decoder = new TextDecoder()
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = JSON.parse(buffer.slice(0, nl))
      buffer = buffer.slice(nl + 1)
      if (line.type === 'result') result = line
      if (line.type === 'error') throw new Error(line.message)
    }
  }
  if (!result) throw new Error('no result')
  return { result, seconds: (Date.now() - started) / 1000 }
}

// ---- Scoring -------------------------------------------------------------------------------
function score(expected: Expected, got: Result) {
  const exp = expected.transactions
  const txns = got.transactions
  let exact = 0
  let amounts = 0
  let categories = 0
  const categoryMisses: string[] = []
  exp.forEach((e, i) => {
    const g = txns[i]
    if (!g) return
    const balanceOk = e.balance_after_cents === null || g.balance_after_cents === e.balance_after_cents
    if (g.amount_cents === e.amount_cents) amounts++
    if (g.date === e.date && g.amount_cents === e.amount_cents && balanceOk) exact++
    if (g.category === e.category) categories++
    else categoryMisses.push(`${e.category} -> ${g.category} (${(g as { merchant?: string }).merchant ?? ''})`)
  })
  const dupFlags = got.anomalies.filter((a) => a.kind === 'duplicate')
  const injected = expected.injected_duplicates
  const found = injected.filter((pair) => dupFlags.some((a) => pair.every((i) => a.transaction_indexes.includes(i)))).length
  const falseDups = dupFlags.filter((a) => !injected.some((pair) => pair.some((i) => a.transaction_indexes.includes(i)))).length
  return {
    expected_count: exp.length,
    extracted_count: txns.length,
    exact,
    amounts,
    categories,
    outcome: got.verification.outcome,
    outcome_ok: got.verification.outcome === expected.expected_outcome,
    duplicates_injected: injected.length,
    duplicates_found: found,
    false_duplicate_flags: falseDups,
    category_misses: categoryMisses,
  }
}

// ---- Run -------------------------------------------------------------------------------------
const db = new pg.Pool({ connectionString: env.DB_URL })
const { rows: limitRows } = await db.query('select global_daily_cap_usd from private.limits')
await db.query('update private.limits set global_daily_cap_usd = 1000')

type Row = { name: string; layout: string; seconds: number; cost: number } & ReturnType<typeof score>
const rows: Row[] = []
const failures: { name: string; error: string }[] = []
if (resume) {
  const previous = readdirSync('evals/results').filter((f) => f.endsWith('.json')).sort().at(-1)
  if (previous) {
    const kept = (JSON.parse(readFileSync(`evals/results/${previous}`, 'utf8')).rows as Row[]).filter(
      (r) => fixtures.includes(r.name) && !rerun.some((prefix) => r.name.startsWith(prefix)),
    )
    rows.push(...kept)
    console.log(`Resuming from ${previous}: keeping ${kept.length} finished statements`)
  }
}
const queue = fixtures.filter((f) => !rows.some((r) => r.name === f))
console.log(`Running ${queue.length} statements, ${concurrency} at a time...\n`)

try {
  await Promise.all(Array.from({ length: concurrency }, async () => {
    let session = await newSession()
    for (let name = queue.shift(); name; name = queue.shift()) {
      if (session.uploads >= 3) session = await newSession()
      session.uploads++
      const expected: Expected = JSON.parse(readFileSync(`${FIXTURES}/${name}.expected.json`, 'utf8'))
      try {
        const { result, seconds } = await runOne(name, session)
        const s = score(expected, result)
        rows.push({ name, layout: expected.layout, seconds, cost: result.cost_usd, ...s })
        console.log(`${name.padEnd(20)} ${s.exact}/${s.expected_count} exact  outcome ${s.outcome}${s.outcome_ok ? '' : ' (WRONG)'}  categories ${s.categories}/${s.expected_count}  $${result.cost_usd.toFixed(3)}  ${seconds.toFixed(0)}s`)
      } catch (e) {
        failures.push({ name, error: (e as Error).message })
        console.log(`${name.padEnd(20)} ERROR ${(e as Error).message}`)
      }
    }
  }))
} finally {
  await db.query('update private.limits set global_daily_cap_usd = $1', [limitRows[0].global_daily_cap_usd])
  await db.end()
}

// ---- Report ----------------------------------------------------------------------------------
rows.sort((a, b) => a.name.localeCompare(b.name))
const total = (k: keyof Row) => rows.reduce((s, r) => s + (r[k] as number), 0)
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a')
const n = total('expected_count')
const layouts = [...new Set(rows.map((r) => r.layout))]
const summary = {
  statements: rows.length,
  errors: failures.length,
  extraction_exact: pct(total('exact'), n),
  amounts_correct: pct(total('amounts'), n),
  count_matches: `${rows.filter((r) => r.extracted_count === r.expected_count).length}/${rows.length}`,
  outcome_correct: `${rows.filter((r) => r.outcome_ok).length}/${rows.length}`,
  category_accuracy: pct(total('categories'), n),
  duplicates_found: `${total('duplicates_found')}/${total('duplicates_injected')}`,
  false_duplicate_flags: total('false_duplicate_flags'),
  total_cost_usd: Number(total('cost').toFixed(4)),
  avg_cost_usd: Number((total('cost') / Math.max(rows.length, 1)).toFixed(4)),
  avg_seconds: Number((total('seconds') / Math.max(rows.length, 1)).toFixed(1)),
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
mkdirSync('evals/results', { recursive: true })
writeFileSync(`evals/results/${stamp}.json`, JSON.stringify({ summary, rows, failures }, null, 2))

const md = [
  `# Eval report`,
  ``,
  `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC on ${rows.length} synthetic statements (${layouts.join(', ')}).`,
  ``,
  `| Metric | Result |`,
  `|---|---|`,
  `| Transactions extracted exactly (date, signed amount, printed balance) | ${summary.extraction_exact} of ${n} |`,
  `| Amount and direction correct | ${summary.amounts_correct} |`,
  `| Transaction count correct | ${summary.count_matches} statements |`,
  `| Verification outcome correct (verified / unverified / failed) | ${summary.outcome_correct} |`,
  `| Category accuracy | ${summary.category_accuracy} |`,
  `| Injected duplicate charges flagged | ${summary.duplicates_found} |`,
  `| Duplicate flags with no injected duplicate (false alarms) | ${summary.false_duplicate_flags} |`,
  `| Cost | US$${summary.total_cost_usd} total, US$${summary.avg_cost_usd} per statement |`,
  `| Time | ${summary.avg_seconds}s per statement on average |`,
  ``,
  `## Per layout`,
  ``,
  `| Layout | Statements | Exact | Outcome correct | Categories |`,
  `|---|---|---|---|---|`,
  ...layouts.map((l) => {
    const rs = rows.filter((r) => r.layout === l)
    const ln = rs.reduce((s, r) => s + r.expected_count, 0)
    return `| ${l} | ${rs.length} | ${pct(rs.reduce((s, r) => s + r.exact, 0), ln)} | ${rs.filter((r) => r.outcome_ok).length}/${rs.length} | ${pct(rs.reduce((s, r) => s + r.categories, 0), ln)} |`
  }),
  ``,
  `## Per statement`,
  ``,
  `| Statement | Exact | Count | Outcome | Categories | Dup found | False dup flags | Cost | Time |`,
  `|---|---|---|---|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.name} | ${r.exact}/${r.expected_count} | ${r.extracted_count} | ${r.outcome}${r.outcome_ok ? '' : ' ✗'} | ${r.categories}/${r.expected_count} | ${r.duplicates_injected ? `${r.duplicates_found}/${r.duplicates_injected}` : '–'} | ${r.false_duplicate_flags} | $${r.cost.toFixed(3)} | ${r.seconds.toFixed(0)}s |`),
  ...(failures.length ? ['', '## Errors', '', ...failures.map((f) => `- ${f.name}: ${f.error}`)] : []),
  '',
].join('\n')
writeFileSync('evals/REPORT.md', md)
console.log('\n' + JSON.stringify(summary, null, 2))
console.log('\nReport written to evals/REPORT.md')
