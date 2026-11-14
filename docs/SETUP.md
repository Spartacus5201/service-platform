# Setup export and import, and history

## The setup file (Admin > Setup, permission `settings.system`: Admin)
One JSON file with everything people configure:

| Section | Matched by | On import |
|---|---|---|
| Settings (the numbers in Admin settings) | key | added / updated |
| Lists (Admin > Lists changes and added items) | list + code | added / updated, never removed |
| Service codes | code | added / updated |
| Catalog and prices (every dated price row) | id | added / updated |
| Equipment registry | manufacturer + model | added / updated; "replaced by" written as the other model's name, so ids need not match |
| Audit rules | code | **made to match the file** (a missing rule means the built-in rule) |
| Import maps (every version) | id + version | added / updated |
| Standard clauses (every version) | key + version | added / updated |
| Roles | key | added / updated |
| Role permissions | role + permission | **each role in the file gets exactly the file's permissions** |

Not in the file: properties, units, audits, visits, documents, invoices, users, passwords, the setup code. Use a full backup (Admin > Backup) for those.

Columns are read from the database, so a column added by a later migration is exported and imported without a code change.

## Importing
1. **Preview**: upload the file. The page shows, per section, what would be added, changed, kept the same, and what is only on this server (kept, or removed where the file is the whole truth). Nothing changes yet.
2. **Import**: runs in one transaction. First the current setup is kept as a **snapshot**; then the file is applied; the Admin role always keeps user and role management; rule changes are recorded as dated rule versions; the import is in the activity log with counts per section.
3. **Undo**: Earlier setups lists the snapshots. "Put back (preview)" previews and imports one like any file. Items added since the snapshot are kept (retire them if not wanted); everything else returns to how it was.

A file from a newer version of the app is flagged in the preview: update this server first.

Moving from the laptop to the company server: run the app there (migrations run on start), sign in as the first Admin, Admin > Setup, import the file exported here. Data comes across separately (a full backup restore, or fresh imports).

## History: explaining past documents
- **Documents** keep exactly what they were issued with (lines, prices, wording); that never changes.
- **Catalog prices** are dated: a price change is a new row with a later "effective from".
- **Property prices**: every change is kept with its date and who made it (`property_price_history`). The property page shows the history; `propertyPricesOn(property, date)` gives the prices in force on a date.
- **Audit rules**: every saved version is kept (`audit_rule_version`). Admin > Audit rules > History shows the dates of changes and the rules in force on any date.
- **Settings and everything else**: the activity log, with before and after.

Rules and prices apply from the moment they are saved; they are not back-dated or future-dated. Future-dated prices (e.g. a price increase from January) come with client price lists (inventory, roadmap item 8).
