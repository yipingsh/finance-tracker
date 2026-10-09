import { supabase } from './supabase'

// Mirrors the NDJSON lines streamed by the process-statement Edge Function.

export type TraceEvent = {
  type: 'trace'
  t: number
  agent: string
  kind: 'start' | 'tool_call' | 'tool_result' | 'llm_call' | 'retry' | 'warning' | 'error' | 'done'
  message: string
  model?: string
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cost_usd?: number
}

export type Transaction = {
  page: number
  row: number
  date: string
  description: string
  amount_cents: number
  balance_after_cents: number | null
  foreign_amount: string | null
  foreign_currency: string | null
  merchant: string
  category: string
  confidence: 'high' | 'medium' | 'low'
  source: 'agent' | 'user_rule' | 'fallback'
}

export type ResultAnomaly = { transaction_indexes: number[]; kind: string; explanation: string }

/** History summary sent with an upload so the categoriser can apply the user's corrections. */
export type CategoriserContext = {
  merchant_rules: { merchant: string; direction: 'in' | 'out'; category: string }[]
  recurring: { merchant: string; typical_amount_cents: number; months_seen: number }[]
  monthly_averages: { category: string; average_cents: number }[]
}

export type Check = { name: string; status: 'pass' | 'fail' | 'skipped'; detail: string }

export type RunResult = {
  type: 'result'
  run_id: string
  statement: {
    institution: string | null
    account_type: string | null
    account_last4: string | null
    currency: string | null
    period_start: string | null
    period_end: string | null
  }
  transactions: Transaction[]
  anomalies: ResultAnomaly[]
  verification: { outcome: 'verified' | 'unverified' | 'failed'; checks: Check[]; issues: { page: number; row?: number; message: string }[] }
  summary: string
  cost_usd: number
}

type Line = TraceEvent | RunResult | { type: 'run'; run_id: string; pages: number } | { type: 'error'; message: string }

/** Uploads a statement and calls `onTrace` for each agent step as it happens. */
export async function processStatement(
  file: File,
  context: CategoriserContext,
  onTrace: (e: TraceEvent) => void,
): Promise<RunResult> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('Not signed in.')

  const form = new FormData()
  form.append('file', file)
  form.append('context', JSON.stringify(context))
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-statement`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}` },
    body: form,
  })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? `Upload failed (${res.status}).`)
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let result: RunResult | undefined
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = JSON.parse(buffer.slice(0, nl)) as Line
      buffer = buffer.slice(nl + 1)
      if (line.type === 'trace') onTrace(line)
      else if (line.type === 'result') result = line
      else if (line.type === 'error') throw new Error(line.message)
    }
  }
  if (!result) throw new Error('The connection closed before processing finished.')
  return result
}
