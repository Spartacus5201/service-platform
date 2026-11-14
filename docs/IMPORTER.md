# Universal importer: design

Goal: any report a person drops in is either imported exactly right, or stopped with a clear reason and a way to fix it by hand. Never silently wrong. Rules-based, no AI.

## Principles
1. **Modular.** One small module per concern, each testable alone: read the file, find the table, match a layout, map columns, convert values, check, preview, commit. Adding a report type never touches the others.
2. **Declarative.** A layout is data (a saved map), not code. The existing hand-written parsers stay until a map reproduces their output exactly, then they are retired one at a time.
3. **Nothing is guessed silently.** Every column mapped, every value converted and every row skipped is shown on a preview before anything is saved. A person confirms.
4. **Manual override at every step.** Pick the sheet, pick the header row, remap any column, fix a value mapping, exclude a row, set a constant (for example the property or the service for the whole file).
5. **Same output as today.** All paths end in the existing commit step (`importParsed`), so history, issues, stages and documents behave the same.

## Pipeline
1. **Read**: xlsx (all sheets) or csv/tsv, any encoding, into plain grids. (exists: `readWorkbook`, `parseCsv`)
2. **Find the table**: header row and data range, per sheet. Auto-guess from the first rows; override by clicking the header row.
3. **Match a saved layout** by header signature (a set of normalised header names, with required and optional columns) and a score. Exact match: proceed. Close match: show it as "looks like X, check it". None: go to the wizard.
4. **Map columns** to the app's fields: building, unit, service, transmitter ID, register/serial, read, read date, battery %, meter type, model, last check-in, and so on. The wizard suggests from header names and sample values; a person fixes.
5. **Convert values** with a small fixed set of converters (text, integer, decimal, US/ISO/Excel date, percent, yes/no, a lookup table for codes such as "W" to Water). Each field has a validator.
6. **Check**: required fields present, no duplicate keys, dates in range, units that are not in the registry listed (these become import issues, as today), unexpected blanks counted.
7. **Preview**: first rows as the app will read them, counts per outcome, every skipped or changed row with its reason. Compare to the last import of the same layout (row count, new units, missing units).
8. **Commit** through `importParsed`. Save the map as a named layout (versioned) and keep the sample file as its test.

## Overrides and safety
- Every override is stored with the layout, so the next file of that kind needs no work.
- A layout has a version; changing one keeps the old version, so an earlier import can always be explained.
- A file that no longer matches its layout (header drift) is stopped, not forced.
- Resident names, balances and account numbers are never mapped (as in the Unit Directory parser).
- Re-importing the same file is a no-op (same as today).

## Build order
1. ~~Layout and map data model + converters + the apply step, with tests.~~ Done: `src/importer/` (convert, layout, apply, targets, builtin, index).
2. ~~Reproduce the AMR Status Report and Unit Directory with maps and prove identical output to the current parsers on the corpus.~~ Done: identical on 3 real AMR Status Reports (645 rows) and 4 real Unit Directories (968 rows), no problems raised. One deliberate difference: an AMR utility the app does not recognise (e.g. "Irrigation") now stops the row for a person to map; the old parser silently made it water.
3. Wizard screens: choose table, map columns, preview, save.
4. Reproduce the audit reports and CIM, then retire the hand-written parsers.
5. New data sets as they arrive: each gets a map, a sample file in the corpus, and a test.

## What is needed from the data sets
For each sample: what it is (which system exports it), which property it is from (names can be scrubbed), what the app should do with it (update units, add readings, set battery, add history), and any column whose meaning is not obvious from the header. Several samples of the same report from different properties help most, since they show how the layout varies.

## Code map
| Module | Job |
|---|---|
| `convert.ts` | One converter per field type (text, label, integer, decimal, percent, date, timestamp, yes/no, service). Returns a value or the exact reason it could not. |
| `layout.ts` | The saved layout (`Layout`, `ColumnRule`) and a person's per-file choices (`Overrides`). |
| `apply.ts` | Pure: one sheet + layout + overrides to kept / empty / excluded / rejected rows, problems, unused headers and blocking reasons. |
| `targets.ts` | What each import target accepts (its fields) and how kept rows become the parse result the commit step already uses. |
| `builtin.ts` | Layouts that ship with the app. |
| `index.ts` | `matchLayouts` (rank layouts for a file) and `preview` (apply + importable + parse result). |

Rules the engine enforces: a required field that is blank or unreadable rejects the row; an optional one is left blank and listed as a warning; a file is importable only with nothing blocking and no rejected rows (fix the mapping, add a lookup, or exclude the row); one column cannot feed two fields; a column and a fixed value cannot both fill one field; repeated keys are reported, never dropped.
