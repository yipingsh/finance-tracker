// Splits an upload into units of work for the extractors: one single-page PDF per page. A CSV is a
// single unit: its format is mapped once and every row is parsed in code (csv.ts).
//
// Many bank statements are encrypted with an EMPTY opening password: anyone can open them, the
// encryption only restricts printing/copying. Those are opened with the empty password and each
// page is re-saved unencrypted. A PDF that needs a real password to open is rejected.
// (@cantoo/pdf-lib is a maintained fork of pdf-lib that adds decryption.)

import { Buffer } from "node:buffer";
import { PDFDocument } from "npm:@cantoo/pdf-lib@2.11.1";
import { MAX_CSV_ROWS } from "./csv.ts";

export const MAX_PAGES = 30;

export type WorkUnit =
  | { index: number; kind: "pdf"; base64: string }
  | { index: number; kind: "csv"; text: string };

export class TooManyPages extends Error {}
export class PasswordRequired extends Error {}

export async function splitIntoUnits(bytes: Uint8Array, kind: "pdf" | "csv"): Promise<WorkUnit[]> {
  if (kind === "csv") {
    const text = new TextDecoder().decode(bytes);
    if (text.split(/\r?\n/).length > MAX_CSV_ROWS + 1) throw new TooManyPages();
    return [{ index: 0, kind: "csv", text }];
  }

  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { password: "" });
  } catch (e) {
    if (/needs password/i.test((e as Error).message)) throw new PasswordRequired();
    throw e;
  }
  const count = source.getPageCount();
  if (count > MAX_PAGES) throw new TooManyPages();
  const units: WorkUnit[] = [];
  for (let i = 0; i < count; i++) {
    const single = await PDFDocument.create();
    const [copied] = await single.copyPages(source, [i]);
    single.addPage(copied);
    units.push({ index: i, kind: "pdf", base64: Buffer.from(await single.save()).toString("base64") });
  }
  return units;
}
