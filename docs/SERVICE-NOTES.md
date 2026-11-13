# Service Notes close-out: design

Status: planned (not built). Based on the three Minol templates: Service Notes (client), Service Invoicing (internal), ID Update (billing system).

## Flow

One **close-out** per visit/WA. Technician notes and photos go in; five outputs come out. Status moves Draft → Approved → Verified → ID record exported → Invoiced → Sent to client. Steps 3 and 4 do not wait for step 2.

| # | Step | Output |
|---|---|---|
| 1 | Process notes | Customer-friendly text per unit, edited and approved by a coordinator. The technician's original is kept unchanged beside it. |
| 2 | Verify what we touched | Per touched endpoint: Pending / Verified / Failed, re-checked on each audit or CIM import (new transmitter checking in, or reads advancing after the visit date). Failed creates a follow-up. |
| 3 | ID update record | Separate Excel for the billing system (below). |
| 4 | Invoicing document | Internal PDF for the admin (below). |
| 5 | Client service notes | PDF for the client (below). |

## Templates, and what changes

**Client Service Notes** (template: one landscape page, header block, 9-column table). Header: property, address, city/state/zip, draft date, property ID, charge code, site contact/phone/email, summary of issues (NI, NT, HIGH/LOW, Other, Total), technician, service date. Columns: Bldg, Unit, Issue, Start Read, End Read, New TX ID, Equipment Used, Comment, Additional Comment.
Keep: header, summary, columns. Add: INT in the summary, an outcome per unit (repaired / replaced / unable to access / no fault found), optional photos appendix, verification status, grouping by building. Never show prices or internal notes. Drawn from the same data and `layout.ts` as the WA, so the two always agree.

**Service Invoicing** (internal only; sent to the admin, who issues the invoice in the company layout). Header: property, address, WA #, property ID, charge code (Billable), site contact, service date, combined total. Lines: Line #, Description, Quantity, EQ Price, Total.
Keep that. Add: identical work grouped into Qty rows (as on the WA), labor and part shown separately, warranty-covered lines at $0 with the reason, charge code 20/21/23 and the year-coded 262000000/262000001 client code, Salesforce case/work order, and a place to record the invoice number back. Marked INTERNAL USE ONLY on every page.

**ID Update** (Excel, keep separate). The template has "FROM UBS" (Serv. Address, Bldg, Unit, MDID, MIUID, Port, Net, Old Meter ID) beside "NEW/CHANGED INFO" (same fields + New Meter ID, System Type, Meter Type), a quality-check re-pull from UBS, a "MF Update" sheet that validates against the current read file, and an "amr recoup" sheet (Old/New Meter ID, Recoup Date). Old Meter ID is MIUID+MDID+Port+Net joined.
Proposed: one generated workbook with the same column layout so the admin's process does not change:
- **Changes**: one row per unit changed; old values from our installation history, new values from the close-out.
- **Recoup**: equipment removed and returned, with date.
- **Validation**: filled in automatically when the next audit/CIM import arrives (transmitter ID matches, meter matches), replacing the manual formula columns and the 5 duplicate sheets.
Gap: Port and Net are not stored yet (they exist in the Manual Audit as Mport / MNetAddr). Needs a migration and import change.

## Build order
A. Intake, customer-friendly text, client notes PDF, invoicing PDF.  B. ID update workbook, then verification.

## Decisions needed
- May Claude process technician notes and photos (data policy / IT)? Otherwise rules and templates only.
- Where photos are stored and for how long.
- Who approves notes before they go to the client.
- How the ID update file reaches UBS (hand-off by file today).
