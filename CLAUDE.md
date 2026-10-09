# Finance Tracker: project guide

Personal finance tracker where Claude agents read uploaded bank/card/e-wallet statements (PDF or
CSV, any bank), verify them, categorise transactions and write a monthly summary. Keep the code
readable and every design decision explainable; prefer simple, well-documented solutions.

## Non-negotiables

- **No financial data on any server.** Statements are processed in Edge Function memory and
  discarded; transactions live only in the user's browser (IndexedDB via Dexie). The server stores
  only anonymous usage counters and costs. Never add server tables, buckets or logs that hold
  statement content. Account numbers are masked to their last 4 digits in code (`mask.ts`).
- **Ask before any paid API run** (pipeline runs, evals, demo builds), with a cost estimate:
  a statement is ~US$0.03–0.06, a full eval ~US$1, a demo build ~US$0.25. Verify with the free
  tests instead wherever possible.
- **Costs are never shown to users** (not in the UI, not stored in the browser). The owner sees
  spend in the Claude Console (`finance-tracker` workspace) or `private.runs`.
- No secrets, real statements or personal data in the repo. Test data is synthetic
  (`scripts/fixtures`); use made-up account numbers in tests.
- Light mode only. Chart colours come from the validated palette in `src/index.css`.
- Don't commit or push unless asked.

## Architecture

```
browser (React + Vite + Tailwind v4, Dexie)
  └─ POST statement ─▶ supabase/functions/process-statement   (Deno)
        validate.ts   file type by bytes, 10 MB
        pages.ts      PDF → single pages (opens empty-password encrypted PDFs); CSV → one unit
        reserve quota (private.reserve_run) BEFORE any Claude call
        orchestrator.ts  Opus 5.5, hand-written tool loop: extract_pages / verify_statement /
                         reextract_page / finish; turn, retry and budget guardrails in code
        extractor.ts  Haiku 5.5 per page, structured output; csv.ts maps CSV columns once,
                      csvParse.ts parses rows in code
        verify.ts     deterministic reconciliation (running balance, totals, opening→closing,
                      page continuity, dates); masks account numbers in normalise()
        categoriser.ts Sonnet 5.5: categories + anomaly flags, applies merchant rules
        streams NDJSON trace + result back
  └─ month aggregates ─▶ supabase/functions/generate-insights  (Opus 5.5 summary)
```

- Quotas/limits: `supabase/migrations/*` → `private` schema (`limits`, `usage_monthly`,
  `daily_spend`, `runs`). 3 uploads + 6 summaries (3 automatic + 3 rewrites) per user per month, US$3 global daily cap.
  Atomic conditional updates, one run at a time per user, stale runs expire after 10 min.
- Auth: Supabase anonymous sign-in behind Cloudflare Turnstile; no email accounts.
- Browser data: `src/lib/db.ts` (Dexie schema, versioned upgrades, separate demo database),
  `src/lib/store.ts` (save results, recategorise, account rules, backup),
  `src/lib/analytics.ts` (pure: totals, recurring detection, month summary),
  `src/lib/rules.ts` (pure: "transfers from …1234" rules, applied in the browser).
- UI: `src/App.tsx` shell (sidebar), `src/features/*` per tab, `src/components/ui.tsx` shared
  pieces, `src/features/dashboard/charts.tsx` hand-rolled SVG charts.
- Categories and their kinds (expense / income / transfer): `supabase/functions/_shared/categories.ts`,
  shared by server and browser. Transfers count as neither income nor spending.

## Commands

Windows machine; Node and Docker Desktop installed. Docker must be running for local Supabase.

```bash
npx supabase start                 # local Postgres/Auth/Gateway (data persists between runs)
npm run functions:serve            # Edge Functions (separate terminal)
npm run dev                        # app on http://localhost:5173
npm test                           # 80 unit + security tests, no AI calls (needs the two above)
npm run build && npm run preview   # production build under the production CSP (port 4173)
node scripts/run-local.ts <file>   # PAID: one statement through the pipeline, prints the trace
node evals/run-evals.ts --resume   # PAID: eval suite, writes evals/REPORT.md
node scripts/build-demo.ts         # PAID: rebuilds public/demo/demo-data.json
```

Secrets for local dev: `supabase/functions/.env` (ANTHROPIC_API_KEY), `supabase/.env` (Turnstile
test secret), `.env.local` (VITE_* public values). All gitignored; `.example` files are committed.

## Gotchas

- **Vite dev server sometimes serves stale modules** after edits on this machine. If the page
  behaves like old code, restart the dev server.
- **The local function server restarts when files are read** (e.g. by `tsc`/`oxlint`), killing
  in-flight requests. Never build or lint while an eval or demo build is running.
- The local gateway answers CORS preflights itself (`*`), so CORS can only be verified when deployed.
- Evals and the demo builder raise the LOCAL global cap while running and restore it.
- Migrations: add new files, never edit applied ones. Apply locally with `npx supabase migration up`.
- Dexie schema changes need a new `d.version(n)` in `db.ts`, with an `upgrade()` for data changes.
- Claude API details (model IDs, structured outputs, caching): check the claude-api skill before
  changing agent code. Opus 5.5 / Sonnet 5.5 can't disable thinking and reject forced tool_choice.

## Docs

- `README.md`: overview and commands
- `docs/security.md`: every security control and the test that covers it
- `docs/deploy.md`: deployment steps and post-deploy checks
- `docs/eval-findings.md`, `evals/REPORT.md`: what the evals measured and caught
