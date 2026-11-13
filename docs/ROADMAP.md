# Roadmap

Direction: build locally (laptop or homelab) until the system is strong enough to show management and win company buy-in. Hosting, SSO and Salesforce credentials wait on IT, so nothing below depends on them except where marked.

## Done
Audit import and rules (99%+ on two real audits), INT rule, Requested by property, WA / Proposal / RFM documents, invoicing codes, WA Notes, unit directory, audit report PDF with repeaters, backup and restore, Service Notes (report entry, rules-based client wording, photos, approval, client notes PDF, internal invoicing PDF, ID update workbook, verification, follow-ups), correction screen, exact-word search, demo dataset (`npm run demo`), Today home screen, demo walkthrough, unit stages and WA link on visits (close-the-loop queues with aging), post-service audit and After Action Report, low battery / preventative maintenance (AMR Status Report import with battery %, PM code, battery pricing, report).

## Next, in order

1. **Jobs: one record per piece of work, request to invoice** (the core of "manage the end-to-end life")
   - A job starts from a request (property call/email, Salesforce case, or an audit) and carries the WA or Proposal, the visits, invoicing, ID updates and the post-service audit.
   - Its stage is worked out from the records: Requested → Audited → Quoted (WA issued) → Authorized (signed WA received) → Scheduled → Serviced → Notes approved → Invoiced → Verified → Closed. Only three things are typed in because nothing else records them: signed-WA received date, scheduled date, and close (with reason if closed early).
   - Jobs board: every open job by stage, with days in stage and the next action; a job page with a timeline of every step.
   - Quoted vs invoiced on each job (WA lines against what was actually done and billed).
2. **Visit page as the five-step checklist** (process notes, check it works, ID update, invoicing sheet, client notes), each step showing done / waiting / blocked, in that order, instead of one long page.
3. **Import reconciliation queue**: units not in the registry and transmitter IDs that differ from our record are shown once at import and then lost. Keep them as open items on Today until resolved (add unit, record the swap, or dismiss with a reason).
4. **Property page tidy-up**: tabs (Overview, Audits & imports, Documents & jobs, Units, Settings) instead of one long page; US dates (11/13/2026) everywhere on screen to match the PDFs; show unit numbers without the audit's leading zeros.
5. **Run it anywhere**: one-command start on Windows; a container plus nightly automatic backup for the homelab, which also serves as the draft handover package for IT.
6. **Salesforce lookup, built to run without credentials**: works against a built-in mock now, switches on when API access arrives. Read-only. Fills the job's case, account and status.
7. **Smaller items**: activity log page (who changed what, from the existing audit log), properties list search and filters, manual theme toggle, resident notice per unit, limit an audit to a property-supplied unit list, upload several photos at once, a "next audit due" date per property, accuracy report from the real audits.
8. **Waiting on IT**: managed Postgres, single sign-on, hosting on the company server. See `IT-QUESTIONS.md` and `SALESFORCE-SETUP.md`.

## Housekeeping (done along the way)
- Photos are stored inside the database; fine at current volume, but backups grow with them. Move to a file folder when hosting moves to the company server.
- Today recalculates every property's latest audit on each page load. Fine for a demo; save the needs-action count when an audit is imported before this goes past a few dozen properties.
- A user can approve their own client notes. Fine for four users; add a setting to require a second person if management asks.

## Open questions
- Battery catalog: batteries are matched to the transmitter model by name in the catalog (component "battery" from the Inventory sheet); until the Inventory sheet is imported with battery rows, $9.10 is used.
- Ray property (AMR Status Report, no unit directory): how zero-usage units that are not NI were excluded.
- Unit 3205 at one test property is a data inconsistency, not a rule problem.
