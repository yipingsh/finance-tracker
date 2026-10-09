// Fixed colour per category, so a category looks the same every month (colour follows the
// entity, never its rank). The validated palette has 8 slots; the 8 most common spending
// categories get one each, everything else folds into a neutral "Other".

export const SLOT_CATEGORIES = [
  'Food & Drink',
  'Shopping',
  'Transport',
  'Groceries',
  'Bills & Utilities',
  'Subscriptions',
  'Payments to people',
  'Entertainment',
] as const

export const OTHER = 'Other'

export function colourOf(category: string): string {
  const i = (SLOT_CATEGORIES as readonly string[]).indexOf(category)
  return i >= 0 ? `var(--cat-${i + 1})` : 'var(--cat-other)'
}

export type Segment = {
  /** A category name, or "Other" */
  label: string
  cents: number
  count: number
  colour: string
  /** The categories in this segment (several for "Other") */
  categories: string[]
}

/**
 * Donut segments in slot order (not size order), so neighbouring slices are always palette
 * neighbours, which is the order validated for colour-blind separation. "Other" goes last.
 */
export function toSegments(byCategory: { category: string; cents: number; count: number }[]): Segment[] {
  const segments: Segment[] = []
  for (const name of SLOT_CATEGORIES) {
    const c = byCategory.find((x) => x.category === name)
    if (c && c.cents > 0) segments.push({ label: name, cents: c.cents, count: c.count, colour: colourOf(name), categories: [name] })
  }
  const rest = byCategory.filter((x) => !(SLOT_CATEGORIES as readonly string[]).includes(x.category) && x.cents > 0)
  if (rest.length) {
    segments.push({
      label: rest.length === 1 ? rest[0].category : OTHER,
      cents: rest.reduce((s, x) => s + x.cents, 0),
      count: rest.reduce((s, x) => s + x.count, 0),
      colour: 'var(--cat-other)',
      categories: rest.map((x) => x.category),
    })
  }
  return segments
}
