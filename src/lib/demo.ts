import { db, stripCost, switchDatabase, type Insight, type MerchantRule } from './db'
import type { RunResult, TraceEvent } from './processStatement'
import { saveResult } from './store'

type DemoData = {
  runs: { file_name: string; file_sha256: string; result: RunResult; events: TraceEvent[] }[]
  budgets: { category: string; amount_cents: number }[]
  /** Older demo files may still carry a cost; it's stripped on load. */
  insights: (Insight & { cost_usd?: number })[]
  merchant_rules?: MerchantRule[]
}

/** Switches to the separate demo database and fills it with the bundled sample data if empty. */
export async function enterDemo() {
  switchDatabase('demo')
  if ((await db.statements.count()) > 0) return
  const res = await fetch('/demo/demo-data.json')
  if (!res.ok) throw new Error("Couldn't load the demo data.")
  const data: DemoData = await res.json()
  for (const run of data.runs) await saveResult(run.result, { name: run.file_name, sha256: run.file_sha256 }, run.events)
  await db.budgets.bulkPut(data.budgets)
  await db.insights.bulkPut(data.insights.map(stripCost))
  await db.merchantRules.bulkPut(data.merchant_rules ?? [])
}

export function exitDemo() {
  switchDatabase('real')
}

/** Clears the demo database and reloads the sample data (undoes anything a visitor changed). */
export async function resetDemo() {
  await db.delete()
  await enterDemo()
}
