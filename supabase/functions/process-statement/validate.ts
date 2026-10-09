// Checks an uploaded file by its actual bytes, never by its name or the browser's MIME type,
// both of which the client controls.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type FileCheck =
  | { ok: true; kind: "pdf" | "csv" }
  | { ok: false; status: number; message: string };

const PDF_MAGIC = new TextEncoder().encode("%PDF-");

function indexOf(haystack: Uint8Array, needle: Uint8Array, limit = haystack.length): number {
  const end = Math.min(limit, haystack.length) - needle.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function checkFile(bytes: Uint8Array): FileCheck {
  if (bytes.length === 0) return { ok: false, status: 400, message: "The file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, message: "Files must be 10 MB or smaller." };
  }

  // The PDF spec allows the header anywhere in the first 1 KB. Encrypted PDFs are allowed here:
  // pages.ts opens those that need no password and rejects those that do.
  if (indexOf(bytes, PDF_MAGIC, 1024) !== -1) return { ok: true, kind: "pdf" };

  // CSV: must be valid UTF-8 text with no control characters other than tab/CR/LF.
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, status: 415, message: "Only PDF and CSV statements are supported." };
  }
  // eslint-disable-next-line no-control-regex -- intentional: rejecting binary content
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text) || !/[,;\t]/.test(text) || !/\r?\n/.test(text)) {
    return { ok: false, status: 415, message: "Only PDF and CSV statements are supported." };
  }
  return { ok: true, kind: "csv" };
}
