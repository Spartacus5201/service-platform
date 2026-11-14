# Inventory and stock take: plan

Goal: Service Platform becomes the home for inventory, replacing the inventory workbook. Until then the workbook stays the master. This is a plan, not built yet.

## What the workbook does today (Inventory_01-2026.xlsx)
- **Inventory** tab: the price list (part type, description, vendor, part number, cost, tariff, markup, sell price) plus company-wide totals. Already imported into the Catalog.
- **One tab per location** (USWW, Install, DAMAGED, MA, MD, VA, NC, Frisco TX, Orlando FL, Miami FL, GA, TN, OH, CO, WA, HI, Los Angeles CA, Daily City CA, Sacramento CA, Irving TX, Houston TX, Austin TX, Sub): technician, location, last count date, then per part: on site (shipped/ordered), reserved, actual used, available balance, value, count, difference, loss/gain.
- **Count Logs**: per location, the date and value difference of each count.
- **List of all units**: storage units by state, technician, storage company, address, unit number, size, and gate and access codes.

## Model
- **Locations**: main office, office install-project stock, damaged/returns, each storage unit (with its technician), and temporary locations (a job site, a vehicle). A location can be closed but never deleted. Gate and access codes are kept apart, shown only to the technician assigned and admins, and never exported.
- **Items**: catalog parts. Most are counted (25 batteries); some are serialized (each transmitter or meter has its own ID once it is in the field).
- **Movements**, the only way a quantity changes, each with who, when, and why. Nothing is edited after the fact; corrections are new movements.
  - receive (purchase order or delivery, into a location)
  - transfer (location to location, e.g. office to a storage unit; in transit until received)
  - reserve (set aside for a job or install project; still on the shelf)
  - use (installed on a visit: comes from the visit record, from the technician's location)
  - return (removed equipment back to the office, or to damaged)
  - adjust (count difference, damage, loss; needs a reason)
  - sell (parts sold to a B2B customer, out of a location)
- **Stock on hand** at a location is the sum of its movements, so it can always be explained line by line.

Rules from the service team:
- A new transmitter comes with a battery fitted: replacing a transmitter uses one transmitter and no battery. A battery replacement (PM) uses one battery.

## Stock take (annual counts, or any time)
1. Start a count for one location; the expected quantities are frozen at that moment.
2. Count sheet: on a phone or printed; blind by default (the counter does not see the expected number).
3. Movements during the count are allowed and are shown separately, so the count is still fair.
4. Review: expected, counted, difference, value of the difference. Recount any line.
5. Approve: one adjust movement per differing line, with the count as the reason. The count, the approver and the value difference go into the count log.

## Getting from the workbook to the app
1. Locations and storage units imported from "List of all units" and the location tabs.
2. Opening balances: each location tab's available balance imported as one "opening balance" movement per part, dated the day of the switch.
3. Run both for one count cycle: counts done in the app, compared with the workbook.
4. When they agree, the app is the master and the workbook is kept read-only.

## Jobs, technicians and balances (decided)
- **Reserved when the job is scheduled.** Scheduling a job reserves its parts (from the WA's bring list) at the assigned technician's location. Reserved stock is still on the shelf but no longer available to other jobs. Rescheduling or reassigning moves the reservation; closing a job releases what was not used.
- **Consumed by the technician who uses it.** Recording the visit uses the parts from that technician's location against the job; anything reserved and not used goes back to available.
- **Balances at three levels:** per location (on hand, reserved, available), per job (reserved, used), and the company total across all locations, with value at cost.
- If a technician's location does not hold enough for a job, scheduling says so and offers a transfer from the office.

## Clients and prices
The sell price is the same at every location, but can differ by client. A client is either a **property** (apartment complex, condo association) or a **B2B customer** (a plumber or electrician buying meters, a handyman buying parts). Each client can have its own price list; anything not on it uses the catalog price. Today a property can already carry its own prices; that becomes the property's client price list.

B2B customers buy parts without a property or a service visit: a **sale** takes the parts out of a location (usually the office), is priced from that customer's list, and goes to Billing like any other invoice.

Stock is always valued at cost.

## Who can do what
A **Manager** approves stock-count differences and other adjustments, at any amount (no second approval). Schedulers and technicians count; only a Manager approves. Roles and what each can do are editable by an Admin: see `ROLES.md`.

## Connects to
- Visits: parts used on a visit come out of the technician's location automatically.
- Documents: the bring list checks stock at the technician's location before a visit.
- Equipment registry: each item knows its model, so obsolete stock can be flagged.
- Install projects: their stock is reserved, not counted as available for service.

## Kept flexible
Locations, location types, reasons for adjustments, and who may approve are all lists or settings an admin or manager changes in the app, not code.
