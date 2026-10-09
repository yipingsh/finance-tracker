// Deterministic verification of extracted transactions. This is plain code, not an AI judgement:
// the numbers either reconcile or they don't. The orchestrator reads this report and decides
// what to retry; it never decides on its own whether the maths adds up.

import { maskAccountNumbers } from "./mask.ts";
import { formatCents, parseCents, parseSignedCents } from "./money.ts";
import type { AccountType, PageExtraction, StatementInfo, Transaction } from "./types.ts";

export type CheckStatus = "pass" | "fail" | "skipped";

export interface Check {
  name: "running_balance" | "page_continuity" | "totals" | "opening_to_closing" | "dates_in_period" | "has_transactions";
  status: CheckStatus;
  detail: string;
}

export interface Issue {
  page: number;
  row?: number;
  message: string;
}

export interface VerificationReport {
  outcome: "verified" | "unverified" | "failed";
  /** How the running balance moves: bank accounts go down on debits, credit cards go up. */
  convention: "bank" | "card";
  checks: Check[];
  issues: Issue[];
}

export interface NormalisedStatement {
  statement: StatementInfo;
  transactions: Transaction[];
  /** Opening balance of the first transaction page (statement or page level), in cents. */
  openingCents: number | null;
  closingCents: number | null;
  pageBounds: { page: number; openingCents: number | null; closingCents: number | null }[];
  problems: Issue[];
}

const STRONG_CHECKS: Check["name"][] = ["running_balance", "totals", "opening_to_closing"];

/** Merge per-page extractions into one statement. `pages[i]` is page i+1. */
export function normalise(pages: (PageExtraction | null)[]): NormalisedStatement {
  const statement = mergeStatementInfo(pages);
  const problems: Issue[] = [];
  const transactions: Transaction[] = [];
  const pageBounds: NormalisedStatement["pageBounds"] = [];

  pages.forEach((page, i) => {
    const pageNo = i + 1;
    if (!page) {
      problems.push({ page: pageNo, message: "page was not extracted" });
      return;
    }
    if (page.page_type !== "transactions") return;
    pageBounds.push({
      page: pageNo,
      openingCents: parseSignedCents(page.page_opening_balance),
      closingCents: parseSignedCents(page.page_closing_balance),
    });
    page.transactions.forEach((t, row) => {
      const cents = parseCents(t.amount);
      const date = resolveDate(t.day, t.month, t.year, statement.period_end);
      if (cents === null) problems.push({ page: pageNo, row, message: `unreadable amount "${t.amount}"` });
      if (date === null) problems.push({ page: pageNo, row, message: "could not work out the date" });
      transactions.push({
        page: pageNo,
        row,
        date: date ?? "",
        // Account numbers are cut to their last 4 digits here, before anything else sees them.
        description: maskAccountNumbers(t.description),
        amount_cents: (cents ?? 0) * (t.direction === "debit" ? -1 : 1),
        balance_after_cents: parseSignedCents(t.balance_after),
        foreign_amount: t.foreign_amount,
        foreign_currency: t.foreign_currency,
      });
    });
  });

  return {
    statement,
    transactions,
    openingCents: parseSignedCents(statement.opening_balance) ?? pageBounds[0]?.openingCents ?? null,
    closingCents: parseSignedCents(statement.closing_balance) ?? pageBounds.at(-1)?.closingCents ?? null,
    pageBounds,
    problems,
  };
}

/** First value printed for each field wins (headers repeat on every page). */
function mergeStatementInfo(pages: (PageExtraction | null)[]): StatementInfo {
  const merged: StatementInfo = {
    institution: null,
    account_type: null,
    account_last4: null,
    currency: null,
    period_start: null,
    period_end: null,
    opening_balance: null,
    closing_balance: null,
    total_debits: null,
    total_credits: null,
  };
  for (const page of pages) {
    if (!page) continue;
    for (const key of Object.keys(merged) as (keyof StatementInfo)[]) {
      if (merged[key] === null && page.statement[key] !== null) {
        (merged as Record<string, unknown>)[key] = page.statement[key];
      }
    }
  }
  return merged;
}

/**
 * Many statements print "01 SEP" with no year. Use the period end's year, stepping back a year
 * for dates that would otherwise fall well after the period (a December row on a January statement).
 */
export function resolveDate(day: number, month: number, year: number | null, periodEnd: string | null): string | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  let y = year;
  if (y === null) {
    if (!periodEnd) return null;
    const end = new Date(`${periodEnd}T00:00:00Z`);
    if (Number.isNaN(end.getTime())) return null;
    y = end.getUTCFullYear();
    const candidate = Date.UTC(y, month - 1, day);
    if (candidate - end.getTime() > 31 * 86_400_000) y -= 1;
  }
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null; // e.g. 31 Sep
  return d.toISOString().slice(0, 10);
}

function conventionFor(type: AccountType | null): "bank" | "card" | null {
  if (type === "credit_card") return "card";
  if (type === "bank_account" || type === "e_wallet") return "bank";
  return null;
}

/** Balance after applying a signed amount under a convention. */
const step = (balance: number, amountCents: number, convention: "bank" | "card") =>
  convention === "bank" ? balance + amountCents : balance - amountCents;

function runningBalanceIssues(n: NormalisedStatement, convention: "bank" | "card"): { issues: Issue[]; compared: number } {
  const issues: Issue[] = [];
  let compared = 0;
  // Balance known so far; null until the first printed balance (or the opening balance).
  let known: number | null = n.openingCents;
  let pending = 0; // sum of amounts since the last printed balance (some banks print one per day)
  for (const t of n.transactions) {
    pending += t.amount_cents;
    if (t.balance_after_cents === null) continue;
    if (known !== null) {
      compared++;
      const expected = step(known, pending, convention);
      if (expected !== t.balance_after_cents) {
        issues.push({
          page: t.page,
          row: t.row,
          message: `balance should be ${formatCents(expected)} but row shows ${formatCents(t.balance_after_cents)}`,
        });
      }
    }
    known = t.balance_after_cents;
    pending = 0;
  }
  return { issues, compared };
}

export function verify(n: NormalisedStatement): VerificationReport {
  const checks: Check[] = [];
  const issues: Issue[] = [...n.problems];

  // Pick the balance convention: from the account type, or whichever fits the running balance.
  let convention = conventionFor(n.statement.account_type);
  if (!convention) {
    const bank = runningBalanceIssues(n, "bank").issues.length;
    const card = runningBalanceIssues(n, "card").issues.length;
    convention = card < bank ? "card" : "bank";
  }

  checks.push(
    n.transactions.length > 0
      ? { name: "has_transactions", status: "pass", detail: `${n.transactions.length} transactions` }
      : { name: "has_transactions", status: "fail", detail: "no transactions found" },
  );

  // 1. Running balance, row by row.
  const rb = runningBalanceIssues(n, convention);
  if (rb.compared === 0) {
    checks.push({ name: "running_balance", status: "skipped", detail: "statement shows no running balance" });
  } else {
    checks.push({
      name: "running_balance",
      status: rb.issues.length ? "fail" : "pass",
      detail: rb.issues.length ? `${rb.issues.length} of ${rb.compared} rows don't add up` : `${rb.compared} rows add up`,
    });
    issues.push(...rb.issues);
  }

  // 2. Page continuity: each page's printed closing balance matches the next page's opening.
  const linked = n.pageBounds.filter((b, i) => i > 0 && b.openingCents !== null && n.pageBounds[i - 1].closingCents !== null);
  if (linked.length === 0) {
    checks.push({ name: "page_continuity", status: "skipped", detail: "no carried-forward balances printed between pages" });
  } else {
    const breaks = linked.filter((b) => {
      const prev = n.pageBounds[n.pageBounds.indexOf(b) - 1];
      return prev.closingCents !== b.openingCents;
    });
    breaks.forEach((b) => issues.push({ page: b.page, message: "opening balance doesn't match the previous page's closing balance" }));
    checks.push({
      name: "page_continuity",
      status: breaks.length ? "fail" : "pass",
      detail: breaks.length ? `${breaks.length} page breaks don't match` : `${linked.length} page breaks match`,
    });
  }

  // 3. Printed totals.
  const totalDebits = parseCents(n.statement.total_debits);
  const totalCredits = parseCents(n.statement.total_credits);
  if (totalDebits === null && totalCredits === null) {
    checks.push({ name: "totals", status: "skipped", detail: "statement prints no totals" });
  } else {
    const debits = n.transactions.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);
    const credits = n.transactions.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
    const wrong: string[] = [];
    if (totalDebits !== null && debits !== totalDebits) wrong.push(`debits ${formatCents(debits)} vs printed ${formatCents(totalDebits)}`);
    if (totalCredits !== null && credits !== totalCredits) wrong.push(`credits ${formatCents(credits)} vs printed ${formatCents(totalCredits)}`);
    if (wrong.length) issues.push({ page: n.pageBounds.at(-1)?.page ?? 1, message: `totals differ: ${wrong.join("; ")}` });
    checks.push({ name: "totals", status: wrong.length ? "fail" : "pass", detail: wrong.length ? wrong.join("; ") : "match the printed totals" });
  }

  // 4. Opening balance + movements = closing balance.
  if (n.openingCents === null || n.closingCents === null) {
    checks.push({ name: "opening_to_closing", status: "skipped", detail: "opening or closing balance not printed" });
  } else {
    const net = n.transactions.reduce((s, t) => s + t.amount_cents, 0);
    const expected = step(n.openingCents, net, convention);
    const ok = expected === n.closingCents;
    if (!ok) issues.push({ page: n.pageBounds.at(-1)?.page ?? 1, message: `closing balance should be ${formatCents(expected)} but statement shows ${formatCents(n.closingCents)}` });
    checks.push({
      name: "opening_to_closing",
      status: ok ? "pass" : "fail",
      detail: ok ? "opening + movements = closing" : `expected ${formatCents(expected)}, statement shows ${formatCents(n.closingCents)}`,
    });
  }

  // 5. Dates fall inside the statement period.
  const { period_start: start, period_end: end } = n.statement;
  if (!start || !end) {
    checks.push({ name: "dates_in_period", status: "skipped", detail: "statement period not printed" });
  } else {
    const outside = n.transactions.filter((t) => t.date && (t.date < start || t.date > end));
    outside.forEach((t) => issues.push({ page: t.page, row: t.row, message: `date ${t.date} is outside ${start} to ${end}` }));
    checks.push({
      name: "dates_in_period",
      status: outside.length ? "fail" : "pass",
      detail: outside.length ? `${outside.length} dates outside the period` : `all within ${start} to ${end}`,
    });
  }

  const failed = checks.some((c) => c.status === "fail") || n.problems.length > 0;
  const strongPassed = checks.some((c) => STRONG_CHECKS.includes(c.name) && c.status === "pass");
  return {
    outcome: failed ? "failed" : strongPassed ? "verified" : "unverified",
    convention,
    checks,
    issues,
  };
}
