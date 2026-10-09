import type { ReactNode } from 'react'
import { colourOf } from '../lib/categoryColors'

// Small shared building blocks so every tab looks like part of the same product.

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl card ${className}`}>{children}</section>
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-(--border) px-5 py-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-(--text-3)">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

const initials = (name: string) =>
  name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·'

export function Avatar({ name }: { name: string }) {
  return <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-(--surface-3) text-xs font-semibold text-(--text-2)">{initials(name)}</span>
}

export function CategoryTag({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-(--text-2)">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colourOf(category) }} aria-hidden />
      {category}
    </span>
  )
}

/** A small headline figure: label above, number below. */
export function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl card px-4 py-3">
      <p className="text-xs text-(--text-3)">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="text-xs text-(--text-3)">{hint}</p>}
    </div>
  )
}

const STATUS = {
  verified: { label: 'Verified', icon: '✓', className: 'border-green-200 bg-green-50 text-green-800' },
  unverified: { label: 'Unverified', icon: '–', className: 'border-amber-200 bg-amber-50 text-amber-900' },
  failed: { label: "Doesn't reconcile", icon: '✗', className: 'border-red-200 bg-red-50 text-red-800' },
} as const

/** Verification status: always an icon and a word, never colour alone. */
export function StatusBadge({ outcome }: { outcome: keyof typeof STATUS }) {
  const s = STATUS[outcome]
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${s.className}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  )
}

export const buttonPrimary = 'rounded-lg bg-(--accent) px-3.5 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-(--accent-hover) disabled:opacity-50'
export const buttonSecondary = 'rounded-lg border border-(--border) bg-(--surface-2) px-3.5 py-1.5 text-sm font-medium hover:bg-(--surface-3) disabled:opacity-50'
export const input = 'rounded-lg border border-(--border) bg-(--surface-2) px-3 py-1.5 text-sm'
