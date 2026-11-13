# Roadmap

Direction: build locally (laptop or homelab) until the system is strong enough to show management and win company buy-in. Hosting, SSO and Salesforce credentials wait on IT, so nothing below depends on them except where marked.

## Done
Audit import and rules (99%+ on two real audits), INT rule, Requested by property, WA / Proposal / RFM documents, invoicing codes, WA Notes, unit directory, audit report PDF with repeaters, backup and restore, Service Notes (report entry, rules-based client wording, photos, approval, client notes PDF, internal invoicing PDF, ID update workbook, verification, follow-ups), correction screen.

## Next, in order

1. **Demo-ready** (the buy-in milestone)
   - A demo dataset with a few synthetic properties at different stages, one command to load it.
   - A "Today" home screen: units needing action, notes waiting for approval, ID updates not yet sent, approved visits not yet invoiced, failed follow-ups.
   - A short walkthrough script and screenshots for management.
2. **Evidence for management**: an accuracy report from the real audits (matches against the final audits, by property) and a before/after comparison of the workbook process. Real names removed.
3. **Salesforce lookup, built to run without credentials**: the integration code and screens work against a built-in mock, so it can be demonstrated now and switched on when the API access arrives. Read-only by design, with a test that proves it.
4. **Run it anywhere**: one-command start on Windows, and a container setup for the homelab that doubles as the draft handover package for IT.
5. **Search**: find a unit, transmitter ID, note or document across properties. Exact-word search first; semantic search stays optional.
6. **Smaller items**: manual theme toggle, resident notice per unit, limit an audit to a property-supplied unit list.
7. **Waiting on IT**: managed Postgres, single sign-on, hosting on the company server. See `IT-QUESTIONS.md` and `SALESFORCE-SETUP.md`.

## Open questions
- Ray property (AMR Status Report, no unit directory): how zero-usage units that are not NI were excluded.
- Unit 3205 at one test property is a data inconsistency, not a rule problem.
