// Shapes shared by the extractor, verifier and orchestrator. No imports, so the pure parts of the
// pipeline (money.ts, verify.ts) can also be unit-tested under Node.

export type Direction = "debit" | "credit";
export type AccountType = "bank_account" | "credit_card" | "e_wallet" | "other";

/** What one extractor returns for one page, as printed (amounts are strings, never floats). */
export interface PageExtraction {
  page_type: "transactions" | "account_summary" | "other";
  /** Only the statement-level details printed on THIS page; everything else is null. */
  statement: StatementInfo;
  /** "Balance brought forward" printed at the top of this page, if any. */
  page_opening_balance: string | null;
  /** "Balance carried forward" printed at the bottom of this page, if any. */
  page_closing_balance: string | null;
  transactions: ExtractedTransaction[];
}

export interface StatementInfo {
  institution: string | null;
  account_type: AccountType | null;
  account_last4: string | null;
  currency: string | null;
  /** YYYY-MM-DD */
  period_start: string | null;
  period_end: string | null;
  opening_balance: string | null;
  closing_balance: string | null;
  total_debits: string | null;
  total_credits: string | null;
}

export interface ExtractedTransaction {
  day: number;
  month: number;
  /** null when the statement prints dates without a year; resolved from the statement period. */
  year: number | null;
  description: string;
  /** Unsigned amount as printed, e.g. "1,000.04". */
  amount: string;
  direction: Direction;
  /** Running balance printed on this row, if the statement shows one. */
  balance_after: string | null;
  foreign_amount: string | null;
  foreign_currency: string | null;
}

/** A transaction after normalisation: ISO date, signed integer cents. */
export interface Transaction {
  page: number;
  row: number;
  date: string;
  description: string;
  /** Negative = money out (spending, fees); positive = money in. */
  amount_cents: number;
  balance_after_cents: number | null;
  foreign_amount: string | null;
  foreign_currency: string | null;
}
