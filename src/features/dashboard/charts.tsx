import { useState } from 'react'
import { Icon } from '../../components/icons'
import { money } from '../../lib/format'

// Hand-rolled charts following the data-viz rules: one hue for single-series magnitude, thin
// marks with rounded data ends, recessive grid, values in text colours (never the bar colour),
// a hover tooltip on every mark, and status colours only ever paired with an icon and a label.

/** Neutral outlined change badge, e.g. "↗ 12%". The arrow carries direction; no colour judgement. */
export function DeltaBadge({ pct }: { pct: number }) {
  const up = pct >= 0
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-(--border) px-1.5 py-0.5 text-xs font-medium tabular-nums text-(--text-2)">
      <Icon name={up ? 'arrowUpRight' : 'arrowDownRight'} className="h-3 w-3" />
      {up ? '+' : '−'}{Math.abs(pct)}%
    </span>
  )
}

/** Tiny trend line for a stat tile: one thin ink line, last point marked. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null
  const W = 64
  const H = 20
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const x = (i: number) => (i / (values.length - 1)) * (W - 4) + 2
  const y = (v: number) => H - 2 - ((v - min) / (max - min || 1)) * (H - 4)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-5 w-16 shrink-0" role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--chart-ink)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2} fill="var(--chart-ink-strong)" />
    </svg>
  )
}

export function StatTile({ label, value, deltaPct, footer, spark }: {
  label: string
  value: string
  deltaPct?: number | null
  footer?: string
  spark?: { values: number[]; label: string }
}) {
  return (
    <div className="flex h-full flex-col rounded-xl card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-(--text-2)">{label}</p>
        {deltaPct != null && <DeltaBadge pct={deltaPct} />}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        {spark && <Sparkline values={spark.values} label={spark.label} />}
      </div>
      {footer && <p className="mt-auto pt-2 text-xs text-(--text-3)">{footer}</p>}
    </div>
  )
}

/**
 * Spending pace: cumulative spending through the month, this month against last month.
 * Two series, so a legend plus direct end labels; a crosshair and tooltip follow the pointer.
 */
export function PaceChart({ current, previous, currentLabel, previousLabel }: {
  /** cumulative cents per day, this month (up to the last day with data) */
  current: number[]
  /** cumulative cents per day, previous month (full month), or empty */
  previous: number[]
  currentLabel: string
  previousLabel: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const days = Math.max(current.length, previous.length, 28)
  const W = 640
  const H = 220
  const pad = { l: 8, r: 8, t: 16, b: 24 }
  const max = Math.max(...current, ...previous, 1)
  const x = (i: number) => pad.l + (i / (days - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
  const area = current.length > 1 ? `${path(current)} L${x(current.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : ''

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - box.left) / box.width) * (days - 1))
    setHover(Math.min(Math.max(i, 0), days - 1))
  }

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-(--text-2)">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-(--chart-ink-strong)" />{currentLabel}</span>
        {previous.length > 0 && (
          <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-(--chart-ink)" />{previousLabel}</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Cumulative spending, ${currentLabel} vs ${previousLabel}`}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--grid)" strokeWidth={1} />
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
        <text x={W - pad.r} y={y(max) - 4} textAnchor="end" fontSize={11} fill="var(--text-3)">{money(max)}</text>
        {[1, 8, 15, 22, days].map((d) => (
          <text key={d} x={x(d - 1)} y={H - 6} textAnchor={d === 1 ? 'start' : d === days ? 'end' : 'middle'} fontSize={11} fill="var(--text-3)">{d}</text>
        ))}
        {previous.length > 1 && <path d={path(previous)} fill="none" stroke="var(--chart-ink)" strokeWidth={2} strokeDasharray="5 4" />}
        {area && <path d={area} fill="var(--chart-ink-strong)" opacity={0.06} />}
        {current.length > 1 && <path d={path(current)} fill="none" stroke="var(--chart-ink-strong)" strokeWidth={2} strokeLinejoin="round" />}
        {current.length > 0 && <circle cx={x(current.length - 1)} cy={y(current[current.length - 1])} r={4} fill="var(--chart-ink-strong)" stroke="var(--surface-2)" strokeWidth={2} />}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} stroke="var(--text-3)" strokeWidth={1} />
            {hover < current.length && <circle cx={x(hover)} cy={y(current[hover])} r={4} fill="var(--chart-ink-strong)" stroke="var(--surface-2)" strokeWidth={2} />}
            {hover < previous.length && <circle cx={x(hover)} cy={y(previous[hover])} r={4} fill="var(--chart-ink)" stroke="var(--surface-2)" strokeWidth={2} />}
          </g>
        )}
        <rect x={pad.l} y={0} width={W - pad.l - pad.r} height={H} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-6 z-10 rounded-lg border border-(--border) bg-(--surface-2) px-3 py-2 text-xs shadow-md"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > days / 2 ? '-105%' : '5%'})` }}
        >
          <p className="font-medium">Day {hover + 1}</p>
          {hover < current.length && <p className="tabular-nums text-(--text-2)">{currentLabel}: <span className="text-(--text-1)">{money(current[hover])}</span></p>}
          {hover < previous.length && <p className="tabular-nums text-(--text-2)">{previousLabel}: <span className="text-(--text-1)">{money(previous[hover])}</span></p>}
        </div>
      )}
    </div>
  )
}

/** Budget progress with a status that never relies on colour alone. */
export function BudgetMeter({ category, spent, budget }: { category: string; spent: number; budget: number }) {
  const ratio = budget > 0 ? spent / budget : 0
  const status =
    ratio > 1
      ? { icon: '✗', label: `Over by ${money(spent - budget)}`, colour: 'var(--critical)' }
      : ratio >= 0.8
        ? { icon: '!', label: `${money(budget - spent)} left`, colour: 'var(--warning)' }
        : { icon: '✓', label: `${money(budget - spent)} left`, colour: 'var(--good)' }
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span>{category}</span>
        <span className="tabular-nums text-(--text-2)">
          {money(spent)} of {money(budget)}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-(--surface-3)" title={`${Math.round(ratio * 100)}% of budget used`}>
        <div className="h-2 rounded-full" style={{ width: `${Math.min(ratio, 1) * 100}%`, background: status.colour }} />
      </div>
      <p className="mt-1 text-xs text-(--text-2)">
        <span aria-hidden className="mr-1 inline-block w-3 text-center font-bold" style={{ color: status.colour }}>
          {status.icon}
        </span>
        {status.label}
      </p>
    </div>
  )
}
