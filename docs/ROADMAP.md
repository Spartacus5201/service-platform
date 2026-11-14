# Roadmap

Direction: build locally (laptop or homelab) until the system is strong enough to show management and win company buy-in. Hosting, SSO and Salesforce credentials wait on IT, so nothing below depends on them except where marked.

## Done
Audit import and rules (99%+ on two real audits), INT rule, Requested by property, WA / Proposal / RFM documents, invoicing codes, WA Notes, unit directory, audit report PDF with repeaters, backup and restore, Service Notes (report entry, rules-based client wording, photos, approval, client notes PDF, internal invoicing PDF, ID update workbook, verification, follow-ups), correction screen, exact-word search, demo dataset (`npm run demo`), Today home screen, demo walkthrough, unit stages and WA link on visits (close-the-loop queues with aging), post-service audit and After Action Report, low battery / preventative maintenance (AMR Status Report import with battery %, PM code, battery pricing, report), jobs (request to invoice: board, job page, timeline, quoted vs invoiced), visit page as the five-step checklist, import problems kept until resolved, property page tabs and unit history links, US dates and unpadded unit numbers, one-command start with first-run setup and daily backups, Docker for the homelab, read-only Salesforce lookup (off / mock / live), activity log, properties filter, next audit due, importer engine, import wizard (map any report's columns once, saved and versioned; Admin → Import maps), service codes as an editable list (WS, GS, EL, HW, CW, HV, WA; Admin → Service codes), equipment registry (models, status, replacement, replacement part and battery from the catalog; Equipment page).

## Future-proofing principle
Facts that change over time are data people edit in the app; the workflow stays in code. Editable things are retired, never deleted, carry "effective from" dates where they affect money or results, and every change is in the activity log. Rules that decide results are tested against real past audits before a change is saved.

## Next, in order

1. **Code review**: an independent review of the whole codebase before the deeper refactors below: correctness, data integrity (append-only history, money), security (sign-in, permissions, uploads), simplicity, and test gaps. Findings fixed or recorded here.
2. **Editable lists**: (service codes done) audit result codes and their meaning, invoicing codes, visit actions, device types, milestone types move from fixed code values to short lists in Admin. Retire, never delete, so old audits and documents still read correctly.
3. **Rules as tables, tested before saving**: which component each audit code points to and whether it needs service become an editable table. Before a change is saved, the last real audits are re-run and the differences shown.
4. **Setup export and import**: the whole setup (lists, equipment, rules, layouts, prices, clauses, settings) as one file, so it moves from laptop to company server unchanged and can be restored. "Effective from" dates on prices and rules so any past document can be explained.
5. **Remaining importer layouts**: audit reports, CIM and each new data set as saved maps, each with a sample file and test; then retire the hand-written parsers one at a time. Paced by the sample data sets.
6. **Smaller items** (done: activity log, properties filter, next audit due). Left: manual theme toggle, resident notice per unit, limit an audit to a property-supplied unit list, upload several photos at once, accuracy report from the real audits.
7. **Photo storage**: photos stay in the app (Salesforce is read-only). Move them out of the database into a photo folder, with a retention choice: keep all, or only the most recent per unit and service (never removed while a visit is open).
8. **Custom fields, if needed**: extra fields on properties, units or equipment, defined in Admin, for display, search and export only (never used by rules).
9. **Waiting on IT**: managed Postgres, single sign-on, hosting on the company server, Salesforce credentials (`SF_MODE=live`). See `IT-QUESTIONS.md`, `SALESFORCE-SETUP.md`, `RUNNING.md`.

## Housekeeping (done along the way)
- Photos are stored inside the database; fine at current volume, but backups grow with them. Moving them to a folder is item 7.
- The Docker image is written but not yet built here (no Docker engine in this environment); first `docker compose up` on the homelab is its test.
- Today recalculates every property's latest audit on each page load. Fine for a demo; save the needs-action count when an audit is imported before this goes past a few dozen properties.
- Time zone: the activity log and import maps show times in `APP_TIMEZONE` (default US Central). Dates the database works out itself ("imported on", "approved on") use its own day, which is UTC in the embedded database, so work done after 6 pm Central can show the next day. Fix by setting the database time zone at startup; check with IT's server settings.
- A user can approve their own client notes. Fine for four users; add a setting to require a second person if management asks.

## Open questions
- Equipment registry: models are added from "In the field but not in the registry" on the Equipment page; catalog parts that name the model are offered as suggestions. A model with no battery set uses the default battery price ($9.10). TR201, seen in the real Crown Court report, is not in the Inventory sheet: its status and replacement need deciding.
- Hot water in reports: "Hot Water" in an AMR or CIM report is now read as HW (it was WS). If billing files hot water meters as WS at some property, those units show under Import problems instead of importing.
- Ray property (AMR Status Report, no unit directory): how zero-usage units that are not NI were excluded.
- Unit 3205 at one test property is a data inconsistency, not a rule problem.
