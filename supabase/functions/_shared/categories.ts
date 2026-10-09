// The category list, shared by the categoriser (server) and the dashboard (browser).
// No imports, so both runtimes can use it.
//
// Kind decides how money is counted: "expense" is spending, "income" is money in, and
// "transfer" moves your own money around (between your accounts, into investments) and is
// counted as neither, so uploading two linked statements never double-counts.

export const CATEGORIES = [
  { name: "Food & Drink", kind: "expense" },
  { name: "Groceries", kind: "expense" },
  { name: "Transport", kind: "expense" },
  { name: "Shopping", kind: "expense" },
  { name: "Bills & Utilities", kind: "expense" },
  { name: "Subscriptions", kind: "expense" },
  { name: "Entertainment", kind: "expense" },
  { name: "Health", kind: "expense" },
  { name: "Education", kind: "expense" },
  { name: "Travel", kind: "expense" },
  { name: "Fees & Charges", kind: "expense" },
  { name: "Payments to people", kind: "expense" },
  { name: "Other spending", kind: "expense" },
  { name: "Income", kind: "income" },
  { name: "Money received", kind: "income" },
  { name: "Refunds & Rebates", kind: "income" },
  { name: "Interest", kind: "income" },
  { name: "Own-account transfers", kind: "transfer" },
  { name: "Investments & Savings", kind: "transfer" },
] as const;

export type CategoryName = (typeof CATEGORIES)[number]["name"];
export type CategoryKind = (typeof CATEGORIES)[number]["kind"];

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name) as [CategoryName, ...CategoryName[]];

export const kindOf = (name: string): CategoryKind =>
  CATEGORIES.find((c) => c.name === name)?.kind ?? "expense";

export const ANOMALY_KINDS = ["duplicate", "subscription", "price_increase", "unusual_amount", "fee"] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];
