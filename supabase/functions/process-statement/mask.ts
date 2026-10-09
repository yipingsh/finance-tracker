// Masks account and card numbers in transaction descriptions, keeping only the last 4 digits:
// "FUND TRANSFER 987654321001 from own account" -> "FUND TRANSFER xxxx1001 from own account".
//
// The extractor is also told not to return full numbers, but that relies on the model obeying;
// doing it in code makes it a guarantee. No imports: shared by the Edge Function and the browser.

/** Any run of 9+ digits (bank account and card numbers), optionally broken up by spaces or dashes. */
const LONG_NUMBER = /\b\d(?:[ -]?\d){8,}\b/g

export function maskAccountNumbers(text: string): string {
  return text.replace(LONG_NUMBER, (match) => {
    const digits = match.replace(/\D/g, '')
    return `xxxx${digits.slice(-4)}`
  })
}
