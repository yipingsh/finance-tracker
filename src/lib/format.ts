const sgd = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' })

/** 123456 -> "$1,234.56" (negative values keep their sign). */
export const money = (cents: number) => sgd.format(cents / 100)

/** "2026-09" -> "Sep 2026" */
export const monthLabel = (month: string, style: 'short' | 'long' = 'short') =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-SG', { month: style, year: 'numeric', timeZone: 'UTC' })
