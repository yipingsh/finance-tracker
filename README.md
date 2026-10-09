# Finance Tracker

A personal finance tracker where several Claude agents do the hard work. Upload a bank, credit
card or e-wallet statement (PDF or CSV, any bank) and the agents extract every transaction, check
the numbers reconcile, categorise everything, flag anything worth a look, and write a plain-English
summary of your month.

**Live site: [finance-tracker-1k3.pages.dev](https://finance-tracker-1k3.pages.dev)**. No account
needed; click **Try the demo** to see a recorded agent run without uploading anything.

**Privacy by design:** statements are processed in memory and never stored on a server. Your
transactions live only in your own browser.

## How it works

```
browser ──upload──▶ Edge Function (Supabase, Deno)
                      │  auth · input checks · quota reserved before any AI call
                      ▼
                    Orchestrator  (Claude Opus 5.5, hand-written tool-use loop)
                      ├─ extract_pages ──▶ Extractors (Claude Haiku 5.5, one per page, in parallel)
                      ├─ verify_statement ─▶ deterministic code: running balance, page continuity,
                      │                       totals, opening + movements = closing, dates
                      ├─ reextract_page ──▶ retry one page with feedback (Sonnet on the 2nd try)
                      └─ finish
                    Categoriser + anomaly checker (Claude Sonnet 5.5)
                      │
browser ◀──live trace (NDJSON stream) + results──┘   saved to IndexedDB, dashboard

monthly summary:  browser ──month aggregates only──▶ Insight writer (Claude Opus 5.5)
```

Design choices worth noting:

- **Code checks the maths, the model decides what to retry.** Verification is plain code, so a
  statement is only "verified" if the numbers actually reconcile; the orchestrator can't overrule it.
- **Guardrails live in code:** turn limit, per-page retry limit and a per-run spending budget.
- **Data minimisation:** the insight writer and categoriser get summaries (totals, merchant names),
  never raw past statements.
- **Security:** anonymous sign-in behind Cloudflare Turnstile, per-user monthly limits and a global
  daily spending cap enforced atomically in Postgres. See [docs/security.md](docs/security.md).

## Evals

`evals/` holds 20 synthetic statements across four layouts (OCBC-style, DBS-style, credit card,
PayPal-style CSV) with known-correct answers, including statements that must fail verification
and injected duplicate charges. Latest results: [evals/REPORT.md](evals/REPORT.md); what they
caught and how it was fixed: [docs/eval-findings.md](docs/eval-findings.md).

## Demo

"Try the demo" loads four synthetic statements that were processed by the real agents
(`scripts/build-demo.ts`) into a separate browser database. Any recorded run can be replayed step by
step, at no cost: the demo makes no AI calls.

## Running locally

Needs Node 20+, Docker Desktop and an Anthropic API key.

```bash
npm install
npx supabase start
cp supabase/functions/.env.example supabase/functions/.env   # then add your ANTHROPIC_API_KEY
cp supabase/.env.example supabase/.env
cp .env.example .env.local                                    # add the publishable key from `npx supabase status`
npm run functions:serve    # terminal 1
npm run dev                # terminal 2
```

| Command | What it does |
|---|---|
| `npm test` | unit tests + security tests (no AI calls, needs local Supabase) |
| `npm run build && npm run preview` | production build, served with the production security headers |
| `node scripts/fixtures/generate.ts` | regenerate the synthetic eval statements |
| `node evals/run-evals.ts` | run the eval suite (~US$1 of API calls; `--resume` to continue an interrupted run) |
| `node scripts/run-local.ts <file>` | run one statement and print the trace |
| `node scripts/build-demo.ts` | rebuild the demo dataset (~US$0.25) |

All sample data in this repository is synthetic. No real statements are ever committed.

## Deploying

Cloudflare Pages (frontend) and hosted Supabase (auth, quotas, Edge Functions): step-by-step in
[docs/deploy.md](docs/deploy.md).
