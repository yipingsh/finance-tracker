import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../../components/icons'
import { useCallback, useEffect, useState } from 'react'
import { db } from '../../lib/db'
import { processStatement, type RunResult, type TraceEvent } from '../../lib/processStatement'
import { writeInsight } from '../../lib/insights'
import { alreadyUploaded, buildContext, saveResult, sha256 } from '../../lib/store'
import { getMyQuota, type Quota } from '../../lib/supabase'
import { InsightCard } from '../dashboard/InsightCard'
import { ResultView } from '../statements/ResultView'
import { ReplayTrace } from '../trace/ReplayTrace'
import { TracePanel } from '../trace/TracePanel'

/** The month a statement's summary is written for: the month it closes in. */
function summaryMonth(r: RunResult): string | null {
  return r.statement.period_end?.slice(0, 7) ?? r.transactions.map((t) => t.date.slice(0, 7)).sort().at(-1) ?? null
}

export function UploadView({ onDone, demo }: { onDone: () => void; demo?: boolean }) {
  const [quota, setQuota] = useState<Quota | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [summary, setSummary] = useState<{ month: string; status: 'writing' | 'done' | 'failed'; message?: string } | null>(null)

  const refreshQuota = useCallback(() => {
    getMyQuota().then(setQuota, (e: Error) => setError(e.message))
  }, [])
  useEffect(refreshQuota, [refreshQuota])

  async function upload(file: File) {
    setEvents([])
    setResult(null)
    setSummary(null)
    setError('')
    // Same file already processed? Stop here, before it uses an upload or costs anything.
    const hash = await sha256(file)
    const existing = await alreadyUploaded(hash)
    if (existing) {
      setError(`You've already uploaded this file (${existing.period_start} to ${existing.period_end}).`)
      return
    }
    setRunning(true)
    const trace: TraceEvent[] = []
    let saved: RunResult | null = null
    try {
      const r = await processStatement(file, await buildContext(), (e) => {
        trace.push(e)
        setEvents([...trace])
      })
      await saveResult(r, { name: file.name, sha256: hash }, trace)
      setResult(r)
      saved = r
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }

    // Then the monthly summary, written automatically from everything saved for that month
    // (this statement plus any other accounts already uploaded). A failure here doesn't affect
    // the saved transactions; the dashboard offers a retry.
    const month = saved && summaryMonth(saved)
    if (month) {
      setSummary({ month, status: 'writing' })
      try {
        await writeInsight(month)
        setSummary({ month, status: 'done' })
      } catch (e) {
        setSummary({ month, status: 'failed', message: (e as Error).message })
      }
    }
    refreshQuota()
  }

  // The demo only replays recorded runs: no uploads, so a visitor can't spend anything.
  if (demo) {
    return (
      <div className="space-y-4">
        <DemoReplay />
        <p className="text-sm text-(--text-2)">Exit the demo to upload your own statements.</p>
      </div>
    )
  }

  const uploadsLeft = quota ? Math.max(quota.uploads_limit - quota.uploads_used, 0) : null
  const disabled = running || summary?.status === 'writing' || uploadsLeft === 0 || quota?.service_available === false
  return (
    <div className="space-y-6">
      <section className="rounded-xl card p-5">
        <label
          htmlFor="statement"
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files[0]
            if (file && !disabled) upload(file)
          }}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-(--accent) hover:bg-(--accent-soft)'} ${dragging ? 'border-(--accent) bg-(--accent-soft)' : 'border-(--border)'}`}
        >
          <span className="grid h-11 w-11 place-items-center rounded-full bg-(--accent-soft) text-(--accent)"><Icon name="upload" className="h-5 w-5" /></span>
          <span className="mt-3 font-medium">{running ? 'Processing…' : 'Drop a statement here, or click to choose'}</span>
          <span className="mt-1 text-sm text-(--text-3)">PDF or CSV · any bank, card or e-wallet · up to 10 MB</span>
          <input
            id="statement"
            type="file"
            accept=".pdf,.csv,application/pdf,text/csv"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) upload(file)
            }}
            className="sr-only"
          />
        </label>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          {quota && (
            <span className="font-medium">
              {uploadsLeft} of {quota.uploads_limit} uploads left this month
              {!quota.service_available && <span className="font-normal text-(--critical)"> · daily processing budget used up, try again tomorrow</span>}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs text-(--text-3)">
            <Icon name="lock" className="h-3.5 w-3.5" />
            Read by Claude, never stored on a server. Remove PDF passwords first.
          </span>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      </section>

      {events.length > 0 && <TracePanel events={events} running={running} />}

      {summary?.status === 'writing' && <div className="rounded-xl card p-4 text-sm text-(--text-2)">Writing your monthly summary…</div>}
      {summary?.status === 'done' && <InsightCard month={summary.month} />}
      {summary?.status === 'failed' && (
        <p className="rounded-xl card p-4 text-sm text-(--critical)">
          Couldn't write the monthly summary: {summary.message} Your transactions are saved; you can retry from the dashboard.
        </p>
      )}

      {result && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-(--text-2)">Saved to this browser.</p>
            <button onClick={onDone} className="rounded-lg bg-(--accent) px-3.5 py-1.5 font-medium shadow-sm hover:bg-(--accent-hover) text-sm text-white">Go to dashboard</button>
          </div>
          <ResultView result={result} />
        </>
      )}
    </div>
  )
}

/** Recruiter demo: pick a recorded run and watch its trace play back. */
function DemoReplay() {
  const statements = useLiveQuery(() => db.statements.orderBy('period_start').toArray(), [])
  const [selected, setSelected] = useState<string | null>(null)
  const run = useLiveQuery(() => (selected ? db.runs.where('statement_id').equals(selected).first() : undefined), [selected])
  if (!statements?.length) return null
  return (
    <section className="rounded-xl card p-5">
      <h2 className="font-semibold">Watch a recorded run</h2>
      <p className="mt-1 text-sm text-(--text-2)">
        See how the agents processed one of the sample statements: Opus plans and checks, Haiku reads pages in parallel, Sonnet categorises.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {statements.map((s) => (
          <button key={s.id} onClick={() => setSelected(s.id)} className={`rounded border px-3 py-1.5 text-sm ${selected === s.id ? 'border-(--accent) bg-(--accent-soft)' : 'border-(--border)'}`}>
            {s.file_name.replace(/\.(pdf|csv)$/, '')} · {(s.period_end ?? s.period_start)?.slice(0, 7)}
          </button>
        ))}
      </div>
      {run && <div className="mt-4"><ReplayTrace key={run.id} events={run.events} /></div>}
    </section>
  )
}
