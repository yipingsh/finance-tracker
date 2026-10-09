// Pure CSV parsing, no network or Deno-only imports, so it can be unit-tested under Node.

import { formatCents } from "./money.ts";
import type { ExtractedTransaction } from "./types.ts";

export const DATE_FORMATS = ["YYYY-MM-DD", "YYYY/MM/DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "DD-Mon-YYYY", "DD Mon YYYY", "Mon DD, YYYY"] as const;

/** Column mapping the model returns for a CSV export (see csv.ts). */
export interface CsvMapping {
  has_header: boolean;
  date_column: number;
  date_format: (typeof DATE_FORMATS)[number];
  description_columns: number[];
  amount_mode: "signed" | "separate_debit_credit";
  amount_column: number | null;
  negative_means: "money_out" | "money_in";
  debit_column: number | null;
  credit_column: number | null;
  balance_column: number | null;
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parseDate(raw: string, format: (typeof DATE_FORMATS)[number]): { day: number; month: number; year: number } | null {
  const s = raw.trim();
  let m: RegExpMatchArray | null;
  let d: number, mo: number, y: number;
  switch (format) {
    case "YYYY-MM-DD": case "YYYY/MM/DD":
      if (!(m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) return null;
      [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]; break;
    case "DD/MM/YYYY": case "DD-MM-YYYY":
      if (!(m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) return null;
      [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]; break;
    case "MM/DD/YYYY":
      if (!(m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return null;
      [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])]; break;
    case "DD-Mon-YYYY": case "DD Mon YYYY":
      if (!(m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\d{4})/))) return null;
      [d, mo, y] = [Number(m[1]), MONTHS[m[2].toLowerCase()], Number(m[3])]; break;
    case "Mon DD, YYYY":
      if (!(m = s.match(/^([A-Za-z]{3})[A-Za-z]* (\d{1,2}),? (\d{4})/))) return null;
      [mo, d, y] = [MONTHS[m[1].toLowerCase()], Number(m[2]), Number(m[3])]; break;
  }
  const date = new Date(Date.UTC(y, (mo ?? 0) - 1, d));
  if (!mo || Number.isNaN(date.getTime()) || date.getUTCDate() !== d) return null;
  return { day: d, month: mo, year: y };
}

/** "-1,234.50", "(12.30)", "S$5" -> signed cents; null if not a number. */
function signedCents(raw: string | undefined): number | null {
  if (raw == null || !raw.trim()) return null;
  const negative = /^\s*-|\(.*\)|-\s*$/.test(raw);
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [w, f = "0"] = cleaned.split(".");
  const cents = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return negative ? -cents : cents;
}

export function applyMapping(rows: string[][], map: CsvMapping): { transactions: ExtractedTransaction[]; unparseable: number } {
  const data = map.has_header ? rows.slice(1) : rows;
  const transactions: ExtractedTransaction[] = [];
  let unparseable = 0;
  for (const r of data) {
    const date = parseDate(r[map.date_column] ?? "", map.date_format);
    let cents: number | null = null;
    if (map.amount_mode === "signed" && map.amount_column !== null) {
      const v = signedCents(r[map.amount_column]);
      cents = v === null ? null : map.negative_means === "money_out" ? v : -v;
    } else {
      const out = map.debit_column !== null ? signedCents(r[map.debit_column]) : null;
      const inn = map.credit_column !== null ? signedCents(r[map.credit_column]) : null;
      cents = out ? -Math.abs(out) : inn ? Math.abs(inn) : null;
    }
    if (!date || cents === null) {
      unparseable++;
      continue;
    }
    const balance = map.balance_column !== null ? signedCents(r[map.balance_column]) : null;
    transactions.push({
      ...date,
      description: map.description_columns.map((c) => (r[c] ?? "").trim()).filter(Boolean).join(" "),
      amount: formatCents(Math.abs(cents)),
      direction: cents < 0 ? "debit" : "credit",
      balance_after: balance === null ? null : formatCents(balance),
      foreign_amount: null,
      foreign_currency: null,
    });
  }
  return { transactions, unparseable };
}
