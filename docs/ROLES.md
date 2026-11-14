# Roles and permissions: plan

Not built yet. Today the app has four fixed roles (admin, office, coordinator, technician) and eight permissions written into the code. This plan replaces that with roles an admin can change in the app.

## Built to change
- **Permissions are small and fixed in code; roles are data.** Each screen and action checks one permission (e.g. `inventory.approve`). Which roles hold which permissions is a grid an Admin edits on one screen; no code change.
- **Roles can be added, renamed or retired** (e.g. a "Field Lead"). The six below ship as the defaults.
- **A person can hold more than one role**; they get everything each role allows. A Scheduler who also works in the field can simply be Scheduler + Technician, instead of a special role.
- **Every change** to a role, its permissions or a person's roles is in the activity log, with before and after.
- **Guards that cannot be switched off:** there is always at least one active Admin; only Admins can change roles and permissions; nobody can remove their own Admin role if they are the last one.
- **Defaults can be restored** per role, so experiments are safe.

## The roles
| Role | Who | In short |
|---|---|---|
| **Admin** | Few people. Technical. | Users, roles, settings, backups, import maps, Salesforce connection, activity log. Not operations by default; an Admin who also works operations holds a second role. |
| **Manager** | Manager over Coordinators and Technicians. | Everything Coordinators and Schedulers do, plus approvals: inventory adjustments and counts, closing jobs early, reopening jobs, corrections to recorded service, and prices. Owns inventory. |
| **Coordinator** | Operations. | Imports and audit review, drafting and issuing WAs, Proposals and RFMs, jobs, equipment and property information, ID updates, service notes approval. |
| **Scheduler** | Schedules work and technicians; sometimes in the field; helps with inventory. | Schedules jobs and assigns technicians (which reserves parts), moves stock between locations, counts stock. Sees jobs and documents, does not draft them. |
| **Technician** | In the field. | Their own schedule, unit history, recording visits and photos, using parts from their own location, counting their own location. Never sees prices. |
| **Billing** | Invoicing. | Invoicing sheets, invoice references, prices and client price lists, document and job money (quoted vs invoiced). Read-only on operations. |

## Permissions (default grid)
✓ = has it. "own" = only their own records (their schedule, their visits, their location).

| Area | Permission | Admin | Manager | Coordinator | Scheduler | Technician | Billing |
|---|---|---|---|---|---|---|---|
| **Properties** | `property.view` — properties, units, unit history | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| | `property.edit` — details, WA notes, contacts, units | | ✓ | ✓ | | | |
| | `client.edit` — clients and B2B customers | | ✓ | ✓ | | | ✓ |
| **Imports & audits** | `import.run` — import reports, import wizard | | ✓ | ✓ | | | |
| | `import.maps` — save and retire import maps | ✓ | ✓ | ✓ | | | |
| | `audit.review` — change a recommendation | | ✓ | ✓ | | | |
| **Jobs** | `job.view` | ✓ | ✓ | ✓ | ✓ | own | ✓ |
| | `job.manage` — create, edit, attach audit, close when done | | ✓ | ✓ | | | |
| | `job.override` — close early, reopen | | ✓ | | | | |
| **Documents** | `document.view` | | ✓ | ✓ | ✓ | | ✓ |
| | `document.draft` — draft and edit WA / Proposal / RFM | | ✓ | ✓ | | | |
| | `document.issue` — issue a version, reconfirm prices | | ✓ | ✓ | | | |
| **Scheduling** | `schedule.manage` — dates, assign technicians (reserves parts) | | ✓ | | ✓ | | |
| | `schedule.view` | | ✓ | ✓ | ✓ | own | |
| **Field** | `visit.record` — service report, photos | | ✓ | ✓ | ✓ | own | |
| | `notes.approve` — approve client notes | | ✓ | ✓ | | | |
| | `service.correct` — correct or void recorded service | | ✓ | | | | |
| | `idupdate.manage` — ID update workbook, confirm with billing system | | ✓ | ✓ | | | |
| **Billing** | `price.view` | | ✓ | ✓ | ✓ | | ✓ |
| | `price.edit` — catalog, property and client prices | | ✓ | | | | ✓ |
| | `invoice.manage` — invoicing sheet, submissions, references | | ✓ | | | | ✓ |
| **Equipment & lists** | `equipment.edit` — equipment registry | | ✓ | ✓ | | | |
| | `lists.edit` — service codes, audit codes, invoicing codes, actions | ✓ | ✓ | | | | |
| | `rules.edit` — audit rules and thresholds (tested before saving) | ✓ | ✓ | | | | |
| **Inventory** | `inventory.view` — stock on hand, reserved, available | | ✓ | ✓ | ✓ | own | ✓ |
| | `inventory.move` — receive, transfer, return | | ✓ | | ✓ | | |
| | `inventory.use` — use parts on a visit | | ✓ | | ✓ | own | |
| | `inventory.count` — enter a stock count | | ✓ | | ✓ | own | |
| | `inventory.approve` — approve counts and adjustments | | ✓ | | | | |
| | `inventory.locations` — locations, storage units, access codes | | ✓ | | | own (codes) | |
| **Admin** | `users.manage` — users and their roles | ✓ | | | | | |
| | `roles.manage` — the permission grid | ✓ | | | | | |
| | `settings.system` — backups, Salesforce, time zone, retention | ✓ | | | | | |
| | `activity.view` — activity log | ✓ | ✓ | | | | |

Notes on the grid:
- Technicians never see prices or values, as today.
- Billing sees operations (jobs, documents, visits) read-only so it can invoice without asking.
- Manager has no Admin permissions by default; a Manager who also administers holds both roles.
- Self-approval: a Manager can approve a count they entered. If that should change, it becomes a setting, not a code change.

## What each role sees first (Today)
| Role | Home queues |
|---|---|
| Manager | Counts waiting for approval, jobs ready to close, follow-ups still failing, stock below minimum, overdue items from every queue. |
| Coordinator | Audits with units not on a WA, import problems, drafts not issued, service notes to approve, ID updates to send or confirm, post-service audits due, low battery. |
| Scheduler | Issued documents not yet scheduled, jobs with parts short at the technician's location, transfers in transit, counts due. |
| Technician | Their visits (today and upcoming), revisits assigned to them, their location's count when due. |
| Billing | Approved visits not yet invoiced, invoices with no reference, quoted vs invoiced differences on closed jobs. |
| Admin | Failed backups, import maps used for the first time, sign-in failures. |

## Activity types (what the activity log records per role's work)
Already logged: sign-ins, password changes, settings, audit changes, catalog imports, client notes approval, service corrections, invoice references, price reconfirmation, import maps, service codes, equipment models.

Added with this plan:
- **Roles:** role created / changed / retired, permission granted / removed, user roles changed.
- **Scheduling:** job scheduled, rescheduled, technician assigned / reassigned, parts reserved / released.
- **Inventory:** received, transferred, transfer received, returned, used on visit, count started, count entered, count approved, adjustment approved, location opened / closed, access code viewed.
- **Billing:** client price list changed, invoice submitted, invoice reference recorded.
- **Documents and jobs:** document issued, job created, closed early (with reason), reopened.

## Moving from today's roles
| Today | Becomes | Why |
|---|---|---|
| admin | Admin + Manager | Keeps everything they can do today. |
| office | Coordinator + Billing | Office staff do both today. |
| coordinator | Coordinator | |
| technician | Technician | |

An Admin reviews each person after the switch and removes what they do not need.

## Build order
1. Permission list in code; roles, role permissions and user roles in the database, seeded with the grid above; every `requireCan` and `can` check moved to the new permissions; existing users moved as in the table.
2. Admin screens: the grid (role by permission, with "restore defaults"), users with several roles, the activity entries.
3. "own" rules: technicians see their own schedule, visits and location.
4. Today by role (queues above).
5. Scheduler and Manager screens arrive with scheduling and inventory.
