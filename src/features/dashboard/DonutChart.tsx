import { useState } from 'react'
import type { Segment } from '../../lib/categoryColors'
import { money } from '../../lib/format'

// Spending by category as a donut. Hovering a slice shows it in the centre; clicking a slice (or
// its legend row) selects it. The legend always shows names and amounts as text, so identity
// never relies on colour alone.

const SIZE = 260
const R = 120
const r = 76
const C = SIZE / 2

const point = (radius: number, angle: number) => [C + radius * Math.cos(angle), C + radius * Math.sin(angle)]

function arc(start: number, end: number, offset: number): string {
  const mid = (start + end) / 2
  const dx = Math.cos(mid) * offset
  const dy = Math.sin(mid) * offset
  // A full circle can't be drawn as one arc; split it in two.
  if (end - start >= Math.PI * 2 - 1e-6) return arc(start, start + Math.PI, 0) + arc(start + Math.PI, end, 0)
  const large = end - start > Math.PI ? 1 : 0
  const [x1, y1] = point(R, start)
  const [x2, y2] = point(R, end)
  const [x3, y3] = point(r, end)
  const [x4, y4] = point(r, start)
  return `M${x1 + dx},${y1 + dy} A${R},${R} 0 ${large} 1 ${x2 + dx},${y2 + dy} L${x3 + dx},${y3 + dy} A${r},${r} 0 ${large} 0 ${x4 + dx},${y4 + dy} Z`
}

export function DonutChart({
  segments,
  selected,
  onSelect,
}: {
  segments: Segment[]
  selected: string | null
  onSelect: (label: string | null) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const total = segments.reduce((s, x) => s + x.cents, 0)
  if (total === 0) return <p className="text-sm text-(--text-3)">No spending this month.</p>

  // Each slice starts where the previous one ended, from 12 o'clock.
  const slices = segments.map((s, i) => {
    const before = segments.slice(0, i).reduce((sum, x) => sum + x.cents, 0)
    const start = -Math.PI / 2 + (before / total) * Math.PI * 2
    return { ...s, start, end: start + (s.cents / total) * Math.PI * 2 }
  })
  const focus = slices.find((s) => s.label === (hover ?? selected))
  const pct = (cents: number) => `${Math.round((cents / total) * 100)}%`
  const toggle = (label: string) => onSelect(selected === label ? null : label)

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-60 shrink-0 overflow-visible sm:w-64" role="img" aria-label="Spending by category">
        {slices.map((s) => {
          const isSel = s.label === selected
          const dim = selected !== null && !isSel && hover !== s.label
          return (
            <path
              key={s.label}
              d={arc(s.start, s.end, isSel ? 6 : 0)}
              fill={s.colour}
              stroke="var(--surface-2)"
              strokeWidth={2}
              opacity={dim ? 0.35 : 1}
              className="cursor-pointer transition-opacity"
              onMouseEnter={() => setHover(s.label)}
              onMouseLeave={() => setHover(null)}
              onClick={() => toggle(s.label)}
            >
              <title>{`${s.label}: ${money(s.cents)} (${pct(s.cents)})`}</title>
            </path>
          )
        })}
        <text x={C} y={C - 8} textAnchor="middle" fontSize={13} fill="var(--text-2)">
          {focus ? focus.label : 'Spent'}
        </text>
        <text x={C} y={C + 16} textAnchor="middle" fontSize={22} fontWeight={600} fill="var(--text-1)">
          {money(focus ? focus.cents : total)}
        </text>
        {focus && (
          <text x={C} y={C + 36} textAnchor="middle" fontSize={12} fill="var(--text-3)">
            {pct(focus.cents)} of spending
          </text>
        )}
      </svg>

      <ul className="w-full min-w-0 divide-y divide-(--border)" aria-label="Categories">
        {slices.map((s) => (
          <li key={s.label}>
            <button
              onClick={() => toggle(s.label)}
              onMouseEnter={() => setHover(s.label)}
              onMouseLeave={() => setHover(null)}
              aria-pressed={selected === s.label}
              className={`w-full rounded-md px-2 py-2 text-left text-sm hover:bg-(--surface-3) ${selected === s.label ? 'bg-(--surface-3)' : ''}`}
            >
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.colour }} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
                <span className="tabular-nums">{money(s.cents)}</span>
                <span className="w-9 text-right text-xs text-(--text-3) tabular-nums">{pct(s.cents)}</span>
              </span>
              {/* Inline share bar: the same number as the slice, readable without the chart */}
              <span className="mt-1.5 ml-4.5 block h-1 rounded-full bg-(--surface-3)">
                <span className="block h-1 rounded-full" style={{ width: `${(s.cents / total) * 100}%`, background: s.colour }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
