# Editable lists

Admin > Lists (permission `lists.edit`: Admin and Manager by default). Service codes have their own page (Admin > Service codes) because they also carry report words.

## How it works
- **Built-in items live in code** (`src/lists/lists.ts`), because the workflow relies on them: Replace asks for parts, NT points at the transmitter, Unable to access starts a revisit.
- **The database holds only what people changed** (`list_item`, migration 029): a new name, wording, order or retirement for a built-in item, and the items people added. An empty table means "as shipped". **Restore** puts a built-in item back as shipped.
- **Nothing is deleted.** A retired item is no longer offered in forms but still reads correctly on old records; a form that shows a record holding a retired value keeps it, marked "(retired)".
- **Every change** is in the activity log, with before and after.

## Three kinds of list
| Kind | Lists | What people can do |
|---|---|---|
| **Fixed** | Visit outcomes, replaced part kinds, equipment kinds, charge codes | Rename, reword, reorder. No new items: the workflow depends on each one. |
| **Works like** | Audit codes, visit actions, visit results | Also add items. Each added item names the built-in item it works like. |
| **Free** | Job sources, property milestones, reading system brands, utilities, property price items | Add, rename, reorder, retire. |

**Works like.** A record keeps the built-in code it works like *and* the item picked:
- An added audit code (say NR, "works like NT") is judged by the audit rules as NT; the audit line keeps NR as the code and shows `ruleCode` NT. Retire it and NR reads as Unrecognized again.
- An added action or result is stored in `service_event.action` / `result` as the built-in (so warranty, revisits, follow-ups, reports and invoicing keep working) and in `action_item` / `result_item` as picked (so it is shown as picked, with its own wording).
- An added action cannot work like Replace: replacing always uses the built-in Replace, which asks for the parts.

## Wording
- **Audit codes:** the opening sentence of the drafted client comment.
- **Visit results:** the sentence for the result. `{part}` becomes the parts replaced ("transmitter", "meter and transmitter"), `{tx}` the new transmitter ID.
- **Replaced part kinds:** the word used for `{part}`.

The coordinator still edits the drafted comment per unit before approval; list wording only changes the draft.

## Where each list is used
| List | Used in |
|---|---|
| Audit codes | Unit visit form (issue), audit lines and recommendations, client comment drafts, close-out issue counts |
| Visit actions / results / outcomes | Visit form, close-out form, correction form, visit page, client notes PDF, After Action Report |
| Replaced part kinds | Visit and close-out forms, client comment wording |
| Equipment kinds | Equipment registry |
| Charge codes | Document header, invoicing sheet |
| Job sources | New job, job page, job timeline |
| Milestones, brands, utilities, price items | WA notes on the property page |

## Left for later
- Which component each audit code points to, and whether it needs service, is the rules (roadmap item 3, "Rules as tables").
- Audit report wording (`src/review/auditreport.ts`) and document line wording per audit code (`WORK_LABEL` in `src/documents/build.ts`) stay in code for now; they follow the code an added item works like.
- Audit review actions (No action, Needs Service, …) stay fixed: they are the rules' outputs.
