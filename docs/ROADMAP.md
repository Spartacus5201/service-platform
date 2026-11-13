# Roadmap

Direction: build locally (laptop or homelab) until the system is strong enough to show management and win company buy-in. Hosting, SSO and Salesforce credentials wait on IT, so nothing below depends on them except where marked.

## Done
Audit import and rules (99%+ on two real audits), INT rule, Requested by property, WA / Proposal / RFM documents, invoicing codes, WA Notes, unit directory, audit report PDF with repeaters, backup and restore, Service Notes (report entry, rules-based client wording, photos, approval, client notes PDF, internal invoicing PDF, ID update workbook, verification, follow-ups), correction screen, exact-word search, demo dataset (`npm run demo`), Today home screen, demo walkthrough, unit stages and WA link on visits (close-the-loop queues with aging), post-service audit and After Action Report, low battery / preventative maintenance (AMR Status Report import with battery %, PM code, battery pricing, report).

## Next, in order

1. **Evidence for management**: accuracy report from the real audits, before/after comparison of the workbook process, and AAR results (share of units fixed on the first visit). Real names removed.
2. **Salesforce lookup, built to run without credentials**: works against a built-in mock now, switches on when API access arrives. Read-only, with a test that proves it.
3. **Run it anywhere**: one-command start on Windows; a container plus nightly automatic backup for the homelab, which also serves as the draft handover package for IT.
4. **Smaller items**: manual theme toggle, resident notice per unit, limit an audit to a property-supplied unit list, upload several photos at once, a "next audit due" date per property.
5. **Waiting on IT**: managed Postgres, single sign-on, hosting on the company server. See `IT-QUESTIONS.md` and `SALESFORCE-SETUP.md`.

## Housekeeping (done along the way)
- Today recalculates every property's latest audit on each page load. Fine for a demo; save the needs-action count when an audit is imported before this goes past a few dozen properties.
- A user can approve their own client notes. Fine for four users; add a setting to require a second person if management asks.

## Open questions
- Low battery threshold: 25% by default (Admin > Settings). On the first real AMR Status Report, 72 of 132 transmitters were at or below 25%: 30 had stopped checking in, 42 still reading. Confirm 25% is the right line for quoting PM.
- Battery catalog: batteries are matched to the transmitter model by name in the catalog (component "battery" from the Inventory sheet); until the Inventory sheet is imported with battery rows, $9.10 is used.
- Ray property (AMR Status Report, no unit directory): how zero-usage units that are not NI were excluded.
- Unit 3205 at one test property is a data inconsistency, not a rule problem.
