# What the evals caught

The eval suite (`evals/`, results in [evals/REPORT.md](../evals/REPORT.md)) is 20 synthetic
statements across four layouts with known-correct answers. Building and running it found real
problems that single happy-path tests had missed.

| Finding | Root cause | Fix |
|---|---|---|
| A 260-row CSV scored 198/260 exact, was wrongly marked "failed" and cost US$0.37 | The verifier parsed **balances** with the amount parser, which drops minus signs. Any negative balance (overdraft, card credit balance) broke the running-balance check | Separate `parseSignedCents` for balances, plus a unit test for an overdraft |
| The same CSV took 187s and many retries | CSVs were split into chunks and re-typed row by row by a model | **The model maps the format, code parses the rows**: Haiku sees the header and 20 sample rows and returns a column mapping; code parses every row. 260/260 exact, US$0.12, 49s, and only sample rows leave the server |
| The orchestrator noticed three identical re-extractions and said the cause was "probably in the file itself" | It was right: the bug was in the verifier, not extraction | Kept the orchestrator's evidence-based reasoning; the trace made this easy to diagnose |
| "Bank Deposit to PP Account" categorised as money received | Wallet top-ups from your own bank look like income | Categoriser instructions now list wallet top-ups and card repayments as own-account transfers |
| The demo's summary listed "TechStore Online" and "Techstore Online" separately | Merchant names differ in capitalisation between statements | Merchants are grouped case-insensitively in summaries |
| An eval run crashed half-way with 502 errors | On Windows, the local function server treats file *reads* (by the build and linter) as changes and restarts | Documented; the eval runner gained `--resume` / `--rerun` so a crash doesn't mean paying for a full re-run |

## Known remaining weaknesses

- **Ambiguous merchants:** almost all category misses are two patterns: a fictional investment app
  ("SampleFin") filed as other spending, and "Sample Mart" as shopping instead of groceries. A model
  can't know an unfamiliar company's business; this is what the learn-from-corrections rules are for
  (the demo shows the rule fixing SampleFin on later uploads).
- **Over-eager duplicate flags:** 4 duplicate flags across 3 statements had no injected duplicate.
  All 4 injected duplicates were caught.
- **Synthetic data only:** the layouts copy real Singapore statement quirks, but real statements
  will be messier. Running a real statement end to end is the next test.
