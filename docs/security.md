# Security design

Anyone with the link can use the app without an account, and the server never stores financial
data. The security work therefore has two goals: keep users' statements private, and stop
strangers or bots from running up the Claude API bill.

## Data handling

- Statements are processed in Edge Function memory, sent to the Claude API, and discarded. They
  are never written to a database, a storage bucket or a log.
- Transactions, budgets and summaries live only in the user's browser (IndexedDB).
- The server stores only: a random anonymous user id, upload counts and API costs.

## Controls (defence in depth)

| # | Layer | Control | Test |
|---|-------|---------|------|
| 1 | Bot check | Cloudflare Turnstile is verified by Supabase Auth before any anonymous session is created | `auth.test.ts` |
| 2 | Identity | Invisible anonymous sign-in; email sign-up is disabled; per-IP sign-in rate limit | `auth.test.ts` |
| 3 | Authentication | The Edge Function verifies the token with the auth server (forged and signed-out tokens are rejected) | `edge-function.test.ts` |
| 4 | Input validation | File type is checked by its bytes (not name or MIME type); 10 MB limit; PDFs encrypted with an empty opening password (common for bank statements) are opened and re-saved unencrypted page by page, while PDFs that need a real password are rejected | `edge-function.test.ts` |
| 5 | Per-user limit | 3 uploads per month per user, reserved **before** any Claude call | `quota.test.ts`, `edge-function.test.ts` |
| 6 | Concurrency | One run at a time per user, enforced by a unique partial index | `quota.test.ts` (20 parallel requests) |
| 7 | Global cap | A daily spending cap across all users, including spend reserved by runs in progress | `quota.test.ts` (10 users racing) |
| 8 | Provider cap | Monthly spending limit set in the Anthropic Console | manual |

### Principles shown

- **Never trust the client.** The browser only displays the quota; the server decides it.
- **Atomic checks (no TOCTOU).** Every limit is a conditional `UPDATE ... WHERE used < limit`
  inside one transaction. Concurrent requests queue on the row lock and re-check the condition,
  and any rejection rolls back the whole reservation.
- **Least privilege.** The browser holds only the publishable key. The usage tables sit in a
  `private` schema the API doesn't expose, with RLS on and no policies. Functions are revoked
  from `public`/`anon`/`authenticated` and granted only to the role that needs them.
- **Fail safe.** A run whose function crashed is expired after 10 minutes and charged its full
  estimate. A failed run gives the upload back only if it spent nothing.
- **Secrets hygiene.** `.env*` files are gitignored; only Turnstile *test* keys appear in example files.

### Tests that the tests work

The suite was checked by deliberately breaking controls (granting `reserve_upload` to browsers,
dropping the one-run-at-a-time index) and confirming the matching tests failed.

## Agent pipeline controls (step 2)

| Control | How |
|---------|-----|
| Page limit | PDFs over 30 pages are rejected before any quota is reserved or model called (`edge-function.test.ts`) |
| Per-run budget | Each run reserves an upper-bound cost; the orchestrator refuses tool calls that would exceed it, and finishes |
| Bounded agent loop | At most 12 orchestrator turns and 2 retries per page, enforced in code |
| Prompt injection | Extractors have no tools and a strict output schema, so text in a statement can't trigger actions; the worst it can do is produce wrong numbers, which the deterministic verifier catches. Tool results are framed as data in the orchestrator's prompt. The synthetic fixtures include an injection line ("Ignore all previous instructions…"), which was ignored in every run |
| Code has the final word | The outcome shown to the user comes from the verifier, not from the model's own conclusion |
| Data minimisation | Extractors are told never to return names, addresses or full account numbers (only the last 4 digits); trace lines carry counts and page numbers, not statement contents |
| Browser-supplied context (step 3) | The history summary sent for categorisation is size-limited (64 KB) and schema-checked: categories must come from the fixed list, so it can't smuggle free-text instructions into the prompt (`edge-function.test.ts`). It holds merchant names and totals only, never raw past statements |
| Duplicate uploads | The browser fingerprints each file (SHA-256) and refuses to re-send one it has already processed, before any quota is used |
| Monthly summaries (step 4) | `generate-insights` accepts only a schema-checked month summary (aggregates, no individual transactions, max 32 KB) is written automatically after each upload and has a per-user monthly limit matching uploads (3), sharing the global daily cap. The writer is told not to give investment or financial-product advice (`edge-function.test.ts`, `quota.test.ts`) |
| CSV privacy | For CSV uploads only the header and ~20 sample rows are sent to the model; every row is parsed in code |
| Demo isolation | The recruiter demo uses a separate IndexedDB database, so sample data never mixes with a visitor's real data. It only replays recorded runs, so demo visitors trigger no AI calls |

## Accepted risks

- A run whose function crashes is expired after 10 minutes and charged its full estimate, but
  expiry happens when that same user next reserves a run. Runs abandoned by users who never come
  back stay "reserved" until the day rolls over. This only errs towards spending less.

- Clearing browser data gives a visitor a new anonymous id and a fresh monthly limit. The global
  daily cap (layer 7) bounds what this can cost.
- CORS is not a security boundary (non-browser clients ignore it); layers 1–7 are.

## Security headers

Since data lives in the browser, XSS is the main threat to user data. `public/_headers` sets a
strict Content-Security-Policy on Cloudflare Pages: scripts only from the app itself and Cloudflare
Turnstile, network requests only to Supabase, no framing, no plugins. Plus `nosniff`,
`X-Frame-Options: DENY`, a strict referrer policy, HSTS and a Permissions-Policy that turns off
camera, microphone, location and payment APIs. `vite preview` applies the same policy so a
production build can be checked locally; the demo, charts, replay, sign-in and quota all ran
under it with zero violations.

## Verified after deploying

- **CORS:** a preflight request to the deployed `process-statement` function from a foreign
  origin gets no `Access-Control-Allow-Origin` header, while the app's own Pages origin is allowed
  by name (not `*`). This couldn't be tested locally, because the local API gateway answers
  preflight requests itself.
- **Production CSP:** a real statement upload, the agent trace, the dashboard and the automatic
  summary all ran on the live site with no console errors or CSP violations.

## Running the tests

Needs Docker running:

    npx supabase start
    npm run functions:serve   # in a second terminal
    npm test
