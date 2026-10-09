// Small stroke icons (24x24 grid, 2px strokes), drawn inline so there's no icon dependency.

const PATHS = {
  logo: ['M3 3v18h18', 'm7 15 4-4 3 3 5-6'],
  overview: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  transactions: ['M3 6h18', 'M3 12h18', 'M3 18h12'],
  subscriptions: ['M17 2.5 21 6.5l-4 4', 'M3 11.5v-1a4 4 0 0 1 4-4h14', 'M7 21.5l-4-4 4-4', 'M21 12.5v1a4 4 0 0 1-4 4H3'],
  budgets: ['M12 2v20', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
  statements: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  arrowUpRight: ['M7 17 17 7', 'M8 7h9v9'],
  arrowDownRight: ['M7 7l10 10', 'M17 8v9H8'],
  chevronRight: ['m9 18 6-6-6-6'],
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  )
}
