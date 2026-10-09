// Money is handled as integer cents end to end. Floats can't represent 0.10 exactly, and a
// reconciliation check that is off by a rounding error is worse than no check.

/** "1,000.04" -> 100004. Also accepts "S$12.30", "12.30 CR", "(12.30)" and "-12.30" (sign ignored). */
export function parseCents(text: string | null | undefined): number | null {
  if (text == null) return null;
  const cleaned = text.replace(/[^\d.]/g, "");
  const match = cleaned.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "0").padEnd(2, "0"));
  return whole * 100 + fraction;
}

/**
 * For balances, which can be negative (an overdraft, a credit balance on a card):
 * "-3.12", "(3.12)" and "3.12-" are -312. Amounts use parseCents; their sign comes from direction.
 */
export function parseSignedCents(text: string | null | undefined): number | null {
  const cents = parseCents(text);
  if (cents === null || text == null) return cents;
  return /^\s*-|\(.*\)|-\s*$/.test(text) ? -cents : cents;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
