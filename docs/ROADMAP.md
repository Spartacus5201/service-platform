# Roadmap

Direction: build locally (laptop or homelab) until the system is strong enough to show management and win company buy-in. Hosting, SSO and Salesforce credentials wait on IT, so nothing below depends on them except where marked.

## Done
Audit import and rules (99%+ on two real audits), INT rule, Requested by property, WA / Proposal / RFM documents, invoicing codes, WA Notes, unit directory, audit report PDF with repeaters, backup and restore, Service Notes (report entry, rules-based client wording, photos, approval, client notes PDF, internal invoicing PDF, ID update workbook, verification, follow-ups), correction screen, exact-word search, demo dataset (`npm run demo`), Today home screen, demo walkthrough, unit stages and WA link on visits (close-the-loop queues with aging), post-service audit and After Action Report, low battery / preventative maintenance (AMR Status Report import with battery %, PM code, battery pricing, report), jobs (request to invoice: board, job page, timeline, quoted vs invoiced), visit page as the five-step checklist, import problems kept until resolved, property page tabs and unit history links, US dates and unpadded unit numbers, one-command start with first-run setup and daily backups, Docker for the homelab, read-only Salesforce lookup (off / mock / live).

## Next, in order

1. **Smaller items**: activity log page (who changed what, from the existing audit log), properties list search and filters, manual theme toggle, resident notice per unit, limit an audit to a property-supplied unit list, upload several photos at once, a "next audit due" date per property, accuracy report from the real audits.
2. **Photos to Salesforce**: photos will ultimately live on the Salesforce case. Needs write access to Case files (ContentVersion), which the current read-only setup does not grant; until then they stay here.
3. **Waiting on IT**: managed Postgres, single sign-on, hosting on the company server, Salesforce credentials (`SF_MODE=live`). See `IT-QUESTIONS.md`, `SALESFORCE-SETUP.md`, `RUNNING.md`.

## Housekeeping (done along the way)
- Photos are stored inside the database; fine at current volume, but backups grow with them. They move to the Salesforce case later (item 2).
- The Docker image is written but not yet built here (no Docker engine in this environment); first `docker compose up` on the homelab is its test.
- Today recalculates every property's latest audit on each page load. Fine for a demo; save the needs-action count when an audit is imported before this goes past a few dozen properties.
- A user can approve their own client notes. Fine for four users; add a setting to require a second person if management asks.

## Open questions
- Battery catalog: batteries are matched to the transmitter model by name in the catalog (component "battery" from the Inventory sheet); until the Inventory sheet is imported with battery rows, $9.10 is used.
- Ray property (AMR Status Report, no unit directory): how zero-usage units that are not NI were excluded.
- Unit 3205 at one test property is a data inconsistency, not a rule problem.
