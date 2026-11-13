# Roadmap

Direction: build locally (laptop or homelab) until the system is strong enough to show management and win company buy-in. Hosting, SSO and Salesforce credentials wait on IT, so nothing below depends on them except where marked.

## Done
Audit import and rules (99%+ on two real audits), INT rule, Requested by property, WA / Proposal / RFM documents, invoicing codes, WA Notes, unit directory, audit report PDF with repeaters, backup and restore, Service Notes (report entry, rules-based client wording, photos, approval, client notes PDF, internal invoicing PDF, ID update workbook, verification, follow-ups), correction screen, exact-word search, demo dataset (`npm run demo`), Today home screen, demo walkthrough.

## Next, in order

1. **Close the loop on every flagged unit** (prerequisite for 2 and 3)
   - Link each service visit to the WA it works (picker on the service report form). Today the link exists in the database but nothing sets it.
   - One status per flagged unit, derived from the records: *flagged → on a WA → visited → verified*, or *not resolved*. The audit page, the property page and Today all read it.
   - Today counts only units with no WA yet, not every flagged unit.
   - New queues: unable to access / unable to complete (needs a revisit), ID updates sent but not confirmed after 14 days, invoicing sheets sent but no invoice number recorded, WA units not yet visited, drafts older than 30 days.
   - Each queue item shows how long it has been waiting.
2. **Post-service audit and After Action Report**
   - After a visit, the system schedules a post-service audit (default 7 days after the visit) and shows it on Today when it is due.
   - Post-service audit: the audit is limited to the units serviced, and each one is compared with how it was before the visit: fixed, still failing, or new problem.
   - After Action Report (PDF, per WA or per visit): what the audit found, what was done, what the post-service audit shows, what is still open and the next step. Uses the existing verification logic, so no new rules.
   - Units that are still failing go straight to the follow-up queue with the AAR attached.
3. **Low battery and preventative maintenance**
   - Data: the Inovonics CIM import already stores a low battery flag per check-in. The Next Century CIM and the audit reports do not yet. We need a sample export to see whether the battery flag is there.
   - Rule: a transmitter that reports low battery on its latest check-in is flagged *PM (preventative maintenance)*, even when it still reads. A unit already failing keeps its failure code and gets the PM flag added.
   - Audit and WA: PM units appear in their own "Preventative maintenance" section, priced from the catalog, so the client can approve them separately.
   - Low battery report (PDF/XLSX per property): transmitter, unit, first date reported low, last check-in, warranty status. Also a cross-property list on Today.
4. **Evidence for management**: accuracy report from the real audits, before/after comparison of the workbook process, and AAR results (share of units fixed on the first visit). Real names removed.
5. **Salesforce lookup, built to run without credentials**: works against a built-in mock now, switches on when API access arrives. Read-only, with a test that proves it.
6. **Run it anywhere**: one-command start on Windows; a container plus nightly automatic backup for the homelab, which also serves as the draft handover package for IT.
7. **Smaller items**: manual theme toggle, resident notice per unit, limit an audit to a property-supplied unit list, upload several photos at once, a "next audit due" date per property.
8. **Waiting on IT**: managed Postgres, single sign-on, hosting on the company server. See `IT-QUESTIONS.md` and `SALESFORCE-SETUP.md`.

## Housekeeping (done along the way)
- `document.visit_id` and `visit.document_id` record the same link in both directions. Keep `visit.document_id` and drop the other one, so they cannot disagree.
- Today recalculates every property's latest audit on each page load. Fine for a demo; save the needs-action count when an audit is imported before this goes past a few dozen properties.
- A user can approve their own client notes. Fine for four users; add a setting to require a second person if management asks.

## Open questions
- Low battery: which reports carry it (Next Century CIM? audit Error columns?), what you call the code today, and whether a battery replacement is covered by the install warranty.
- Ray property (AMR Status Report, no unit directory): how zero-usage units that are not NI were excluded.
- Unit 3205 at one test property is a data inconsistency, not a rule problem.
