# Service Platform

Replaces the Excel template system: schema, business rules, report importers, built-in login, service history, documents (WA, Proposal, RFM), invoicing, and a web UI.

Docs for the team and IT: `docs/ROADMAP.md`, `docs/SERVICE-NOTES.md`, `docs/IT-QUESTIONS.md`.

Spec: "Service Platform — Data Model & Screen-Flow Spec" (Claude Docs).

## Run it
To just use it: double-click `start.cmd` (Windows) or run `./start.sh`, or `docker compose up -d` on a server. See docs/RUNNING.md. For development:

```bash
npm install
npm test            # about 125 tests, about 2 min (each test starts its own in-memory database)
npm run typecheck
npm run seed        # builds a synthetic property and runs the whole pipeline
npm run seed -- --data .pgdata       # same, persisted on disk
npm run users -- ./credentials.md --data .pgdata   # create logins (see Login)
npm run build && npm start           # the web app on http://localhost:3000 (npm run dev for development)
```

Environment: `DATA_DIR` (database folder, default `.pgdata`), `APP_TZ` (default `America/Chicago`, sets "today"), `COOKIE_SECURE=true` (set behind HTTPS), `MIGRATIONS_DIR` (only if the app is run from another folder).

No Postgres install is needed: [PGlite](https://pglite.dev) runs Postgres in-process. The SQL in `db/migrations` is plain Postgres and runs unchanged on managed Postgres (add the `vector` extension there for semantic search later).

## Layout

| Path | What it holds |
|---|---|
| `db/migrations/001_core.sql` | Whole schema: registry, equipment, imports, service, documents, billing, users, settings |
| `src/rules/audit.ts` | Audit-code cascade, INT rule, issue-to-component mapping |
| `src/rules/warranty.ts` | Three warranty layers and coverage for a visit |
| `src/parsers/` | One parser per report format, plus format detection and the `.xlsx` reader |
| `src/import/commit.ts` | Writes a parsed report to the database; duplicate detection; 180-day purge of raw files |
| `src/queries/audit.ts` | Audit review lines: each reading with its recommendation and warranty position |
| `src/auth/auth.ts` | Built-in login (scrypt hashes, forced first-login change, roles). One module, so SSO can replace it |
| `src/dev/synthetic.ts` | Invented property data for dev and demos |
| `scripts/check-real.ts` | Parses real report files and prints counts only |

## Rules implemented

- **Audit codes:** OK none; NI Needs Service if occupied; NT Needs Service; IDMM Verify ID; LOW Investigate (property) if occupied; HIGH Investigate (property); NEG Investigate (service coordinator); anything else shows Unrecognized.
- **INT:** automated systems with ReadCount below 10 (setting) in the window need service. Manual meters (MANUAL in MeterTypeID or ManufacturerID) need service only at ReadCount 0. INT with no ReadCount is Unrecognized, never silent.
- **Occupancy:** from the AutoAudit file's ServiceAddr range. First date is the move-in, and `01/01/00` there means Vacant. Second date is the prior move-out (informational). Reads and AuditResult in that file are ignored when it is imported as an occupancy file.
- **Warranty:** install (property, one completion date, parts and labor), service labor (endpoint, any completed touch), service part (device, installed during service). Unable to Access and Unable to Complete do not count. RFM has none. Terms and the 30-day Expiring window are settings.
- **Retention:** raw import files are discarded 180 days after import (`purgeExpiredImports`). Parsed readings, service history, and notes are kept.
- **Documents:** WA numbers are `ClassID-YYMMDD`, with -2, -3 for same-day repeats; quotes are valid 30 days. (Schema is in place; the builder comes with the UI.)

## Login

Credentials never go in the repo. Keep a local file (already git-ignored as `credentials*`) with a table:

```
| email | name | role | temporary password |
|---|---|---|---|
| you@example.com | Your Name | admin | a-long-temporary-password |
```

then `npm run users -- ./credentials.md --data .pgdata`. Passwords are stored as salted scrypt hashes and must be changed at first sign-in. Roles: admin, office, coordinator, technician (technicians never see prices).

## Assumptions to confirm against real data

1. Gas maps to ServiceID `GS`, electric to `EL` (confirmed), everything else to `WS`.
2. PSR collector and repeater serials are treated as the CIM repeater IDs so the two reports meet on one device (confirmed).
3. PSR "Meter IDs" is stored as the meter's optional serial number (confirmed).
4. A transmitter ID that differs from the one on record is reported as an ID change for review. It is never overwritten, because a swap should come from a service record.
5. A unit with no occupancy data yet is treated as occupied, with the reason shown.
6. Naive timestamps (Zenner ISO text with no offset) are stored as UTC.
7. Login hashing is scrypt (Node built-in, no native dependency) rather than argon2.

## Data handling

Development uses synthetic data only. `*.xlsx` is git-ignored. Real files are parsed locally with `npm run check:real -- file.xlsx`, which prints counts and never names or addresses.

## Phase 2 (service, documents, invoicing)

- **Service** (`src/service`): `recordVisit` writes a visit with events and part replacements in one transaction. Replacing a device retires the old one, installs the new one on the visit date, and starts its part warranty. Warranty position is stored on each event when it is recorded. `correctEvent` appends a superseding event (refused once invoiced, and for replace events). `endpointHistory` returns the timeline, devices, and current coverage for one endpoint.
- **Documents** (`src/documents`): `createDocument` builds WA, Proposal, or RFM lines from an audit batch (Needs Service lines are priced from the catalog; Investigate and Verify ID lines are not). `issueVersion` freezes a version, merges clauses, and sets the 30-day quote window. `newVersion` copies lines forward without restarting the window. `quoteStatus` / `reconfirmPricing` handle approval after expiry. `renderDocumentHtml` produces a client copy and a technician copy; prices are removed from the technician copy, not hidden.
- **Invoicing** (`src/billing`): `uninvoicedEvents` and `submitInvoice`. Each event or part can be sent once; covered work is recorded non-billable at $0 unless overridden with a reason.
- `npm run seed -- --out ./sample-out` writes sample client and technician copies of a Work Authorization.

Assumptions in this phase: a quote window of 30 days is counted from the issue date and shown as expired after the 30th day; part-warranty lines bill at $0 while labor-only coverage is shown per line; amounts on an invoice are entered by the office (no price logic beyond the catalog default on documents).

## Phase 3 (web UI)

Next.js 15 App Router with server actions; no client-side data layer. Screens: sign-in and forced password change, properties, property page (import, units, documents, imports), audit review (needs-action filter, recommendations, warranty, draft a document), document page (edit draft, issue, client and technician copies, new version, reconfirm pricing), endpoint page (warranty layers, devices, history, record a visit or replacement), invoicing, price catalog, clauses. The nav shows only what the role may use; the technician role never receives prices.

Verified with a Playwright run on synthetic data: login, password change, import, audit review, WA draft and issue (unit address on both copies), technician privacy, visit with replacement, invoicing.

## Golden audit corpus

`corpus/` holds raw reports paired with the audit a person signed off on. `npm run corpus` scores the program against them (match rate per case and brand, every differing row with its report code). See `corpus/README.md` for the folder format. Real cases go in `corpus/real-*` (git-ignored).

## Admin

`/admin` (admin role only): add users (a one-time temporary password is shown; they must choose their own at first sign-in), change roles, reset passwords, deactivate or reactivate (takes effect on their next click, even mid-session), and edit the rule settings (INT read threshold, warranty months, expiring window, quote validity, raw-file retention). The last active admin cannot be demoted or deactivated. Every change is written to the audit log. Retention is enforced on every import and from a button here. The credentials-file script (`npm run users`) still works for first setup.

## Search

The box in the top bar (and `/search`) does literal search: every word must appear in the same record, any order, case-insensitive. It covers properties (name, ClassID, address), units (building-unit such as `1-101`, address, vendor label), devices (transmitter/repeater ID, serial, model), service history (notes, technician, Case and Work Order numbers) and, for roles that can edit documents, documents (number, title, Case, Work Order). Results link to the endpoint, property or document. `src/search/search.ts` is plain SQL (`ILIKE`), fine for tens of thousands of records; semantic search will sit on top of the same records once embeddings are available.

## PDF copies

Issuing a version renders and stores a client PDF and a technician PDF (`document_version.client_pdf` / `tech_pdf`), drawn directly with pdfkit, so no browser or outside service is needed and what was sent is kept exactly as sent. Download links are on the document page (`/documents/<id>/pdf?v=<n>&copy=client|tech`); technicians can only fetch the technician copy. `npm run sample:pdf -- ./out` writes samples. Letter, portrait; Latin-1 text (other characters print as `?`).

## Reviewer corrections and exports

On the audit review screen a reviewer can change any recommendation (action, who owns an Investigate, which part) with a required reason. The rules' own answer is kept beside it, changes are logged, and documents are drafted from the final answer. Downloads: CSV, Excel, and "Save as test case" (a zip with the raw files, `case.json`, `expected.csv`, and `reviewer-notes.csv`; unzip it into `corpus/real-*` and fill in `brand`). Running `npm run corpus` on that case then shows exactly the rows where the rules disagreed with the reviewer. A case can only be built while the raw file is still retained (180 days).

## Dark mode

Follows the operating system setting (colors are tokens in `app/globals.css`). A manual toggle is not built.

## Document numbers, charge codes, labor and layouts

- **Number prefix** (invoicing code): `262000000` while the property is under install warranty (the first two digits are the last two digits of the year, so `272000000` in 2027); `262000001` when we installed it, the warranty has ended and it has no billing contract; otherwise the property's ClassID. Format `CODE-YYMMDD`, then `-2`, `-3` for more on the same day. Tick "Has a billing contract" on the property.
- **Charge code** on each document: 20 Billable, 21 MSA, 23 Installation Warranty. Defaults to 23 under install warranty, otherwise 20; change it on the draft.
- **Labor**: `labor_rate` (Admin > Settings, $85) is the starting labor price per unit on new Needs Service lines and invoice rows. Every line can be overridden. Warranty zeroes labor, or part and labor.
- **Layout**: identical work is grouped into one row (Qty, Parts per unit, Labor per unit, Total) with the unit list on its own page; WA copies include a resident access notice page; Proposals have Submitted to, notes, shipping and handling, prepared-by initials and an acceptance block. Standard wording lives in Clauses (keys `wa_intro`, `wa_estimate`, `quote_notice`, `quote_expiry`, `wa_authorization`, `proposal_acceptance`, `resident_notice`); the layout places each by key. The Minol header and footer images are in `assets/`.
- `npm run sample:pdf -- ./out` writes sample WA and Proposal PDFs.

## WA Notes and Unit Directory

- **WA Notes** (property page): utility and meter, system brand and collector/gateway ID and location, install/takeover/upgrade date, a technician note, the transmitter and meter to install, extra equipment to bring, and prices for that property (labor, meter, transmitter, ...). They print on the technician copy only. The "technician brings" list counts transmitters and meters from the document and names them from the notes. A property price replaces the catalog price and the default labor charge on new documents. Tick "Meter service agreement" for charge code 21.
- **Client wording** per audit code on documents: NT "Meter Service - Non-Transmitting", NI "Meter Service - No Usage", and so on (`WORK_LABEL` in `src/documents/build.ts`), so identical work groups into one row.
- **Unit Directory (.csv)** import supplies move-in dates when the audit's ServiceAddr has none. Only building, unit and the dates are read; resident names, account numbers and balances are never read, and the file itself is not kept. Blank start date, an end date, or `# Occ` of null/0 means vacant.
- Non-billing codes follow the year: `262000000` / `262000001` in 2026, `272000000` / `272000001` in 2027.

## Not built yet

Semantic search (pgvector, needs the managed database), the Salesforce read-only lookup, the price-list integration, and the user guide.

## Audit report (PDF) and Requested by property
- Audit review → **PDF** exports the final audit: real audit period (earliest to latest read date in the import), unit issue counts (NI, NT, INT, high/low, other/requested, MSA), legend, one row per unit needing action, and a **Repeaters** section (location, ID, last check-in, Online/Offline). Anything not in the imports shows "Not available"; with no CIM imported the Repeaters section says so. Offline = no check-in within 24 h of the most recent repeater check-in.
- **Requested by property** is a reviewer action (override) for a complaint the data does not support or a requested inspection / usage accuracy test; it becomes an unpriced inspection line on the WA/Proposal. Properties without a unit directory (262000001) are audited and coded by their actual issues instead.

## Backup and restore
Admin → **Download a full backup** gives a `.tgz` of the whole database. Restore with the app stopped: `npx tsx scripts/restore.ts <file>`; the existing data folder is renamed `*.before-restore-<time>`, never deleted. Older backups are migrated forward on restore.

## Service notes (close-out)
Property page → **Record service report**: starts from the latest audit's units; enter action, result, start/end read, new part and transmitter ID, and the technician's comment. The next screen (`/visits/<id>`) shows drafted client wording from fixed phrase templates (no AI; `src/service/phrases.ts`), editable per unit, plus an opening paragraph and photos (JPEG/PNG, up to 8 MB, optionally shown to the client). **Approve** to finalize; any edit returns it to draft. Downloads: **Client notes PDF** (landscape, your template's columns plus Result; photos page) and **Invoicing sheet PDF** (internal only: grouped work, labor default or property price, parts from property price or catalog, warranty lines at $0, charge and invoicing codes). **Record as sent to admin** logs it through the existing invoicing records, so nothing is invoiced twice. Needs `edit_documents` (notes) and `edit_prices` (invoicing sheet).

## Corrections
Service notes page → **Correct this record**. Change visit details (date, technician, outcome, Salesforce refs, notes), a unit's action/issue/result/reads/comment, or the new transmitter ID of a replacement, or **void** a unit entered by mistake (a voided replacement puts the old equipment back on record and frees the ID). A reason is required; every change is logged with who, when and what, and shown on the visit. Nothing is deleted. A new date or outcome recalculates warranty coverage and moves install dates. Invoiced units are read-only. Editing sends approved client notes back to draft. Code: `src/service/correct.ts`.

## ID update record and verification
- **ID update** (service notes page → *ID update record*): for each unit where equipment was replaced, the billing system's old values (MDID = transmitter ID, MIUID, Port, Net) beside the new ones. Port and Net are stored per unit (default 0, read from the Manual Audit's Mport/MNetAddr) and can be overridden here. *Download workbook* gives the same column layout as the existing ID Update template (FROM UBS / NEW/CHANGED INFO / QUALITY CHECK with its match formulas, plus an AMR recoup sheet). *Mark as sent to billing* freezes the rows. A later audit or CIM import that shows the new transmitter ID marks the row **confirmed** automatically.
- **Did it work?** Each unit on a visit is Pending, Verified or Failed from later imports: an audit whose whole window is after the visit (OK = verified; NT/NI/INT/IDMM = failed; a vacant NI is fine), or a transmitter check-in after the visit for transmitter issues. A replaced transmitter whose old ID still appears in a later audit is flagged as needing the billing update. Failed units appear under **Needs follow-up** on the property page when no later service has happened. Code: `src/service/idupdate.ts`, `src/service/verify.ts`.

## Demo
`npm run demo` builds a synthetic dataset in `.pgdata-demo`; `npm run demo:start` serves it. See docs/DEMO.md.

## Work tracking, After Action Report, low battery
- Every flagged unit has a stage derived from the records (needs a WA, on a document, serviced, revisit, still failing); see the audit page Status column and the Today queues.
- Link a service visit to its WA on the service report form. The visit page shows the post-service audit; `/aar?visit=` or `/aar?document=` gives the After Action Report PDF. Setting `post_audit_days` (default 7).
- Low battery: import the Next Century AMR Status Report (.csv) like any other report; Battery at or below 25% is flagged PM (preventative maintenance) on audits, the report and Today; at or below 1% it goes on new WAs/Proposals (a battery line while still reading, or the failure line priced as a battery once stopped). Battery price comes from a catalog battery matching the transmitter model, else $9.10; parts and labor follow warranty. Report at Property > Low battery report (Excel). Settings in Admin.

## Jobs
A job is one piece of work for one property, from the request to the invoice. Start one on the property page when a request comes in (Salesforce case, phone, email), attach the audit, draft the WA / Proposal / RFM from the job, and record service against it. A document drafted straight from an audit starts a job automatically. The stage (Requested, Audited, Document drafted, Quoted, Serviced, Notes approved, Follow-up needed, Verifying, Ready to close, Closed) is worked out from what is linked; only the request and the close are typed in. Authorization and scheduling stay on the Salesforce case (status copied by hand until Salesforce is connected). Jobs board at /jobs; each job page has the timeline, units with links to their history, and quoted vs invoiced.
