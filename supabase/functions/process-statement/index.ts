// Entry point for statement processing.
//
// 1. Security gates: auth, input checks, page limit, quota reservation (all before any Claude call).
// 2. The agent pipeline runs while its trace streams back to the browser as NDJSON.
//
// Privacy rule: the file lives only in this request's memory. Nothing from it is stored or
// logged; logs carry run ids and error codes only. Results go back to the browser, which keeps them.

import { corsHeaders, json } from "../_shared/cors.ts";
import { getUser } from "../_shared/supabase.ts";
import { finishRun, QuotaRejected, reserveUpload } from "../_shared/quota.ts";
import { Tracer } from "../_shared/trace.ts";
import { categorise, ContextSchema, EMPTY_CONTEXT, type CategoriserContext } from "./categoriser.ts";
import { orchestrate } from "./orchestrator.ts";
import { MAX_CSV_ROWS } from "./csv.ts";
import { MAX_PAGES, PasswordRequired, splitIntoUnits, TooManyPages, type WorkUnit } from "./pages.ts";
import { checkFile, MAX_UPLOAD_BYTES } from "./validate.ts";

/**
 * Upper bound for one run, reserved against the quotas before starting. The run stops itself
 * before spending more, so the global daily cap can't be overshot.
 */
const budgetFor = (pages: number) => 0.25 + pages * 0.01;
const MAX_CONTEXT_BYTES = 64 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed." });

  const user = await getUser(req);
  if (!user) return json(req, 401, { error: "Not signed in." });

  // Reject oversized bodies before reading them. Content-Length can be absent or wrong, so the
  // real size is checked again after reading.
  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return json(req, 413, { error: "Files must be 10 MB or smaller." });
  }

  let file: File;
  let context: CategoriserContext = EMPTY_CONTEXT;
  try {
    const form = await req.formData();
    const value = form.get("file");
    if (!(value instanceof File)) return json(req, 400, { error: "Attach the statement as `file`." });
    file = value;
    // Optional history summary from the browser, used by the categoriser. User-controlled, so
    // size-limited and schema-checked like any other input.
    const raw = form.get("context");
    if (typeof raw === "string" && raw) {
      if (raw.length > MAX_CONTEXT_BYTES) return json(req, 413, { error: "Context is too large." });
      const parsed = ContextSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return json(req, 400, { error: "Invalid context." });
      context = parsed.data;
    }
  } catch {
    return json(req, 400, { error: "Expected a multipart form upload." });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkFile(bytes);
  if (!check.ok) return json(req, check.status, { error: check.message });

  let units: WorkUnit[];
  try {
    units = await splitIntoUnits(bytes, check.kind);
  } catch (e) {
    if (e instanceof PasswordRequired) {
      return json(req, 422, { error: "This PDF needs a password to open. Open it, save or print a copy without a password, and upload that." });
    }
    if (e instanceof TooManyPages) return json(req, 422, { error: `Statements can have at most ${MAX_PAGES} pages (or ${MAX_CSV_ROWS} CSV rows).` });
    return json(req, 422, { error: "This file couldn't be read. Is it a valid PDF or CSV?" });
  }

  // Reserve quota BEFORE any Claude call, so a rejected request costs nothing.
  const budgetUsd = budgetFor(units.length);
  let reservation;
  try {
    reservation = await reserveUpload(user.id, budgetUsd);
  } catch (e) {
    if (e instanceof QuotaRejected) return json(req, e.status, { error: e.message, code: e.code });
    console.error("reserve_upload failed", (e as Error).message);
    return json(req, 500, { error: "Something went wrong. Please try again." });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (line: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
        } catch {
          open = false; // browser went away; the run still finishes and is charged correctly
        }
      };
      const tracer = new Tracer(send);
      send({ type: "run", run_id: reservation.runId, pages: units.length, uploads_used: reservation.uploadsUsed, uploads_limit: reservation.uploadsLimit });

      try {
        const { normalised, report, summary } = await orchestrate(units, tracer, budgetUsd);
        const { categorised, anomalies } = await categorise(normalised.transactions, context, tracer);
        await finishRun(reservation.runId, tracer.costUsd, true);
        send({
          type: "result",
          run_id: reservation.runId,
          statement: normalised.statement,
          transactions: normalised.transactions.map((t, i) => ({ ...t, ...categorised[i] })),
          anomalies,
          verification: report,
          summary,
          cost_usd: tracer.costUsd,
        });
      } catch (e) {
        console.error("run failed", reservation.runId, (e as Error).name);
        await finishRun(reservation.runId, tracer.costUsd, false).catch(() => {});
        send({ type: "error", run_id: reservation.runId, message: "Processing failed. Please try again." });
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: { ...corsHeaders(req), "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
});
