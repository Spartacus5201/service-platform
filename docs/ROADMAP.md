# Roadmap

Direction: build locally (laptop or homelab) until the system is strong enough to show management and win company buy-in. Hosting, SSO and Salesforce credentials wait on IT, so nothing below depends on them except where marked.

## Done
Audit import and rules (99%+ on two real audits), INT rule, Requested by property, WA / Proposal / RFM documents, invoicing codes, WA Notes, unit directory, audit report PDF with repeaters, backup and restore, Service Notes (report entry, rules-based client wording, photos, approval, client notes PDF, internal invoicing PDF, ID update workbook, verification, follow-ups), correction screen, exact-word search, demo dataset (`npm run demo`), Today home screen, demo walkthrough, unit stages and WA link on visits (close-the-loop queues with aging), post-service audit and After Action Report, low battery / preventative maintenance (AMR Status Report import with battery %, PM code, battery pricing, report), jobs (request to invoice: board, job page, timeline, quoted vs invoiced), visit page as the five-step checklist, import problems kept until resolved, property page tabs and unit history links, US dates and unpadded unit numbers, one-command start with first-run setup and daily backups, Docker for the homelab, read-only Salesforce lookup (off / mock / live).

## Next, in order

1. **Smaller items**: activity log page (who changed what, from the existing audit log), properties list search and filters, manual theme toggle, resident notice per unit, limit an audit to a property-supplied unit list, upload several photos at once, a "next audit due" date per property, accuracy report from the real audits.
2. **Universal importer**: one import screen that recognises any report layout from its headers. Each known layout is a saved column map (which column is building, unit, transmitter ID, read, date, battery...), so a new report type is added by mapping its columns once, not by writing code. Unknown files show their columns for a person to map, then that map is saved for next time. Rules-based, no AI. Built from the additional sample reports being collected; every map gets a test file in the corpus.
3. **Photo storage**: photos stay in the app (Salesforce access is read-only). Move them out of the database into a photo folder with the database keeping only the reference, and add a retention choice: keep all, or keep only the most recent photo per unit and service (older ones removed after a set time, never while a visit is still open).
4. **Waiting on IT**: managed Postgres, single sign-on, hosting on the company server, Salesforce credentials (`SF_MODE=live`). See `IT-QUESTIONS.md`, `SALESFORCE-SETUP.md`, `RUNNING.md`.

## Housekeeping (done along the way)
- Photos are stored inside the database; fine at current volume, but backups grow with them. Moving them to a folder is item 3.
- The Docker image is written but not yet built here (no Docker engine in this environment); first `docker compose up` on the homelab is its test.
- Today recalculates every property's latest audit on each page load. Fine for a demo; save the needs-action count when an audit is imported before this goes past a few dozen properties.
- A user can approve their own client notes. Fine for four users; add a setting to require a second person if management asks.

## Open questions
- Battery catalog: batteries are matched to the transmitter model by name in the catalog (component "battery" from the Inventory sheet); until the Inventory sheet is imported with battery rows, $9.10 is used.
- Ray property (AMR Status Report, no unit directory): how zero-usage units that are not NI were excluded.
- Unit 3205 at one test property is a data inconsistency, not a rule problem.
