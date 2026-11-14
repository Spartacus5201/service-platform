# Audit rules

Admin > Audit rules (permission `rules.edit`: Admin and Manager by default).

## What a rule is
One rule per audit code:
- **Part**: transmitter, meter, "technician decides" (manual pick) or none. A unit flagged as a combo device is always "both" when the rule names a part.
- **Method**: *by occupancy* (the two outcomes below) or *intermittent* (counts reads: the INT method, with its two numbers in Admin settings).
- **Occupied** and **Vacant** outcomes: recommendation (No action, Needs Service, Verify ID, Investigate, Review manually), owner (property, service coordinator or none), and the reason shown. Unknown occupancy is treated as occupied, and the reason says so when occupancy would have changed the answer.

The built-in table (`DEFAULT_RULES` in `src/rules/audit.ts`) gives exactly the original answers (checked across every combination of code, occupancy, combo, manual read, read count and last real read). The database (`audit_rule`, migration 030) holds only rules that differ from it; saving the built-in rule again removes the row.

## Changing a rule: tested before saving
1. Edit the rules on the page and press **Test changes**. The form is kept as your draft (one per person); nothing changes yet.
2. The test runs the latest audit of every property (up to 50, newest first) with the rules in force and with the draft, and lists every unit whose recommendation would change. For units a reviewer decided, it shows how often the rules agree with the reviewer now and with the draft (better, worse or the same).
3. **Save these rules** applies the draft. The save re-runs the test and logs it with the change (activity log: `rules_changed`, before and after per code, units changed, reviewer agreement). **Discard draft** throws it away.

Saved rules apply to every audit view and new document from then on. Reviewer decisions, issued documents and recorded service keep what they were made with.

## Added audit codes
An audit code added under Admin > Lists works like a built-in code and uses that code's rule until it is given **its own rule** on this page. Its document and client wording still follow the code it works like. A retired added code is not recognised (Review manually).

## Not in the table (yet)
- Which part follow-up checks treat as "transmitter related" uses the built-in parts.
- "Requested by property" is only ever set by a reviewer.
- Effective dates for rules (so an old audit can be shown with the rules of its day) come with setup export and import (roadmap item 4). Until then the activity log records every version.
- The golden corpus (`npm run eval`) checks the built-in rules against real audits a person signed off on.
