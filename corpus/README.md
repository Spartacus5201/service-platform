# Golden audit corpus

Each folder is one property-run: the raw files exactly as the system produced them, and the audit a person signed off on.

```
corpus/<case>/
  case.json      who/what/when (below)
  raw/           untouched report files (.xlsx)
  expected.csv   the final audit
```

**case.json**
```json
{ "name": "oak-court-2026-10", "brand": "Inovonics", "classId": "9900001", "asOf": "2026-10-28",
  "installedByUs": true, "installCompletedOn": "2025-03-12",
  "files": [ { "file": "raw/auto-audit.xlsx" }, { "file": "raw/occupancy.xlsx", "purpose": "occupancy" } ],
  "notes": "Anything unusual about this run." }
```
`asOf` is the date the audit was done (warranty is judged on it). List an occupancy file first if the audit needs it. Add PSR or CIM files too when they were part of the decision.

**expected.csv** — one row per unit that needs something; leave out units with no action.
```
building,unit,service,action,owner,component
1,102,WS,Verify ID,,transmitter
1,104,WS,Investigate,service coordinator,
```
`action` is one of: Needs Service, Verify ID, Investigate, Unrecognized. `owner` and `component` are optional; if filled they are checked too.

**Run it:** `npm run corpus` (all cases) or `npm run corpus -- corpus/<case>`. It prints a match rate per case and per brand, and every row that differs, with the report code, so each difference is either a rule to fix or a correction the person made that the rules should learn.

**Privacy:** real cases go in folders named `real-*`, which git ignores. Names and addresses in raw files stay on your machine and in your deployment.

**What helps most:** a few cases per brand; include runs where the reviewer changed the program's answer (those teach the most); keep the reviewer's reason in `notes` or a `reason` column.
