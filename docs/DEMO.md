# Demo walkthrough (about 10 minutes)

All data is invented. Nothing connects to Salesforce, billing, or any company system.

## Start
```
npm install
npm run demo          # builds .pgdata-demo with three synthetic properties
npm run demo:start    # http://localhost:3000
```
Sign in: `demo@example.test` / `Demo-Pass-2026`. Re-run `npm run demo` any time to reset.

## The story
1. **Home / Today.** One page of everything waiting on someone: units needing action, notes waiting approval, approved visits not yet sent for invoicing, ID updates not yet sent, fixes that did not hold.
2. **Maple Ridge (we installed, warranty active).** Open the property. Audit report shows each unit's recommendation (NT, NI, INT...). The WA is issued with the Salesforce case. The visit shows replacements, "Did it work?" (one verified, one failed), invoicing sheet at warranty price, and the sent ID update that a later audit confirmed. Open *Corrections* to see how a mistake is fixed without losing history.
3. **Harbor View (warranty expired, no billing contract).** Visit recorded; client notes still draft. Show the wording suggestions (fixed rules, no AI), add a photo, approve, then download the client service-notes PDF.
4. **Cedar Court (MSA).** Approved visit, not yet invoiced. Download the internal invoicing sheet (marked INTERNAL USE ONLY) and the ID update workbook in the existing template layout. Shows the Proposal draft.
5. **Search** a unit or transmitter ID to see its full service history.

## Points to make
- Replaces linked workbooks: one record per unit, history never overwritten.
- Rules-based. No AI in the live workflow.
- Runs on one machine today; needs a company server and read-only Salesforce access to go further (see IT-QUESTIONS.md, SALESFORCE-SETUP.md).
