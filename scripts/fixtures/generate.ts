// Generates the eval suite: synthetic statements + their known-correct answers.
// Deterministic: the same manifest always produces the same files.
//
// Usage: node scripts/fixtures/generate.ts

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { buildFixture, type FixtureSpec } from './layouts.ts'

export const MANIFEST: FixtureSpec[] = [
  // OCBC-like bank statements
  { name: 'bank-a-sep', layout: 'bank-a', seed: 7, month: 9, count: 55 },
  { name: 'bank-a-aug', layout: 'bank-a', seed: 11, month: 8, count: 50 },
  { name: 'bank-a-jul', layout: 'bank-a', seed: 23, month: 7, count: 40 },
  { name: 'bank-a-long', layout: 'bank-a', seed: 31, month: 10, count: 75 },
  { name: 'bank-a-dup', layout: 'bank-a', seed: 41, month: 9, count: 30, duplicate: true },
  { name: 'bank-a-bad-totals', layout: 'bank-a', seed: 7, month: 9, count: 55, corrupt: true },
  // DBS-like bank statements
  { name: 'bank-b-sep', layout: 'bank-b', seed: 5, month: 9, count: 45 },
  { name: 'bank-b-aug', layout: 'bank-b', seed: 13, month: 8, count: 60 },
  { name: 'bank-b-dup', layout: 'bank-b', seed: 17, month: 7, count: 30, duplicate: true },
  { name: 'bank-b-bad-totals', layout: 'bank-b', seed: 19, month: 10, count: 40, corrupt: true },
  // Credit card statements (period crosses two months)
  { name: 'card-sep', layout: 'card', seed: 3, month: 9, count: 30 },
  { name: 'card-aug', layout: 'card', seed: 9, month: 8, count: 40 },
  { name: 'card-jul', layout: 'card', seed: 15, month: 7, count: 20 },
  { name: 'card-dup', layout: 'card', seed: 21, month: 10, count: 35, duplicate: true },
  { name: 'card-bad-totals', layout: 'card', seed: 27, month: 9, count: 30, corrupt: true },
  // PayPal-like CSV exports
  { name: 'csv-balance-sep', layout: 'csv', seed: 1, month: 9, count: 40, csvBalance: true },
  { name: 'csv-balance-aug', layout: 'csv', seed: 2, month: 8, count: 25, csvBalance: true },
  { name: 'csv-balance-large', layout: 'csv', seed: 3, month: 7, count: 260, csvBalance: true },
  { name: 'csv-nobalance-sep', layout: 'csv', seed: 4, month: 9, count: 30 },
  { name: 'csv-nobalance-dup', layout: 'csv', seed: 6, month: 8, count: 30, duplicate: true },
]

const OUT = 'evals/fixtures'
mkdirSync(OUT, { recursive: true })
for (const f of readdirSync(OUT)) rmSync(`${OUT}/${f}`)
for (const spec of MANIFEST) {
  const { bytes, ext, expected } = await buildFixture(spec)
  writeFileSync(`${OUT}/${spec.name}.${ext}`, bytes)
  writeFileSync(`${OUT}/${spec.name}.expected.json`, JSON.stringify(expected, null, 2) + '\n')
  console.log(`${spec.name.padEnd(20)} ${ext}  ${String(expected.transactions.length).padStart(3)} txns  expect ${expected.expected_outcome}${expected.injected_duplicates.length ? '  +duplicate' : ''}`)
}
