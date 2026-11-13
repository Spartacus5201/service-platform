# Roadmap

Direction: build locally (laptop or homelab) until the system is strong enough to show management and win company buy-in. Hosting, SSO and Salesforce credentials wait on IT, so nothing below depends on them except where marked.

## Done
Audit import and rules (99%+ on two real audits), INT rule, Requested by property, WA / Proposal / RFM documents, invoicing codes, WA Notes, unit directory, audit report PDF with repeaters, backup and restore, Service Notes (report entry, rules-based client wording, photos, approval, client notes PDF, internal invoicing PDF, ID update workbook, verification, follow-ups), correction screen, exact-word search, demo dataset (`npm run demo`), Today home screen, demo walkthrough, unit stages and WA link on visits (close-the-loop queues with aging), post-service audit and After Action Report, low battery / preventative maintenance (first pass).

## Next, in order

1. **Low battery, finish** (needs answers below): confirm the code name and warranty treatment; read the battery flag from the Next Century export and the audit Error columns if they carry it; add PM to the audit report PDF.
2. **Evidence for management**: accuracy report from the real audits, before/after comparison of the workbook process, and AAR results (share of units fixed on the first visit). Real names removed.
3. **Salesforce lookup, built to run without credentials**: works against a built-in mock now, switches on when API access arrives. Read-only, with a test that proves it.
4. **Run it anywhere**: one-command start on Windows; a container plus nightly automatic backup for the homelab, which also serves as the draft handover package for IT.
5. **Smaller items**: manual theme toggle, resident notice per unit, limit an audit to a property-supplied unit list, upload several photos at once, a "next audit due" date per property.
6. **Waiting on IT**: managed Postgres, single sign-on, hosting on the company server. See `IT-QUESTIONS.md` and `SALESFORCE-SETUP.md`.

## Housekeeping (done along the way)
- Today recalculates every property's latest audit on each page load. Fine for a demo; save the needs-action count when an audit is imported before this goes past a few dozen properties.
- A user can approve their own client notes. Fine for four users; add a setting to require a second person if management asks.

## Open questions
- Low battery: which reports carry it (Next Century CIM? audit Error columns?), what you call the code today (setting `pm_code`, default PM), and whether a replacement is covered by warranty (setting `pm_warranty`: `part` follows normal part warranty [default], `never` always billable).
- Ray property (AMR Status Report, no unit directory): how zero-usage units that are not NI were excluded.
- Unit 3205 at one test property is a data inconsistency, not a rule problem.
