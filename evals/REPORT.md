# Eval report

Run 2026-10-09 08:05 UTC on 20 synthetic statements (bank-a, bank-b, card, csv).

| Metric | Result |
|---|---|
| Transactions extracted exactly (date, signed amount, printed balance) | 100.0% of 1034 |
| Amount and direction correct | 100.0% |
| Transaction count correct | 20/20 statements |
| Verification outcome correct (verified / unverified / failed) | 20/20 |
| Category accuracy | 95.9% |
| Injected duplicate charges flagged | 4/4 |
| Duplicate flags with no injected duplicate (false alarms) | 4 |
| Cost | US$0.9244 total, US$0.0462 per statement |
| Time | 32.4s per statement on average |

## Per layout

| Layout | Statements | Exact | Outcome correct | Categories |
|---|---|---|---|---|
| bank-a | 6 | 100.0% | 6/6 | 93.9% |
| bank-b | 4 | 100.0% | 4/4 | 92.2% |
| card | 5 | 100.0% | 5/5 | 94.2% |
| csv | 5 | 100.0% | 5/5 | 100.0% |

## Per statement

| Statement | Exact | Count | Outcome | Categories | Dup found | False dup flags | Cost | Time |
|---|---|---|---|---|---|---|---|---|
| bank-a-aug | 51/51 | 51 | verified | 50/51 | – | 0 | $0.052 | 29s |
| bank-a-bad-totals | 56/56 | 56 | failed | 50/56 | – | 0 | $0.072 | 58s |
| bank-a-dup | 32/32 | 32 | verified | 32/32 | 1/1 | 0 | $0.041 | 32s |
| bank-a-jul | 41/41 | 41 | verified | 39/41 | – | 0 | $0.038 | 29s |
| bank-a-long | 76/76 | 76 | verified | 72/76 | – | 1 | $0.069 | 35s |
| bank-a-sep | 56/56 | 56 | verified | 50/56 | – | 0 | $0.048 | 32s |
| bank-b-aug | 61/61 | 61 | verified | 54/61 | – | 2 | $0.057 | 47s |
| bank-b-bad-totals | 41/41 | 41 | failed | 39/41 | – | 0 | $0.062 | 52s |
| bank-b-dup | 32/32 | 32 | verified | 28/32 | 1/1 | 0 | $0.045 | 30s |
| bank-b-sep | 46/46 | 46 | verified | 45/46 | – | 0 | $0.039 | 37s |
| card-aug | 40/40 | 40 | verified | 40/40 | – | 1 | $0.035 | 27s |
| card-bad-totals | 30/30 | 30 | failed | 28/30 | – | 0 | $0.051 | 44s |
| card-dup | 36/36 | 36 | verified | 34/36 | 1/1 | 0 | $0.033 | 34s |
| card-jul | 20/20 | 20 | verified | 19/20 | – | 0 | $0.031 | 26s |
| card-sep | 30/30 | 30 | verified | 26/30 | – | 0 | $0.030 | 28s |
| csv-balance-aug | 25/25 | 25 | verified | 25/25 | – | 0 | $0.023 | 14s |
| csv-balance-large | 260/260 | 260 | verified | 260/260 | – | 0 | $0.123 | 49s |
| csv-balance-sep | 40/40 | 40 | verified | 40/40 | – | 0 | $0.028 | 16s |
| csv-nobalance-dup | 31/31 | 31 | unverified | 31/31 | 1/1 | 0 | $0.025 | 15s |
| csv-nobalance-sep | 30/30 | 30 | unverified | 30/30 | – | 0 | $0.024 | 15s |
