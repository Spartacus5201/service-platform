// Build a synthetic property in a local database and run the full pipeline against it.
// Usage: npm run seed [-- --data .pgdata] [--out ./sample-out]
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { parseCimNextCentury } from '../src/parsers/cim';
import { parsePsr } from '../src/parsers/psr';
import { auditLines, needsAction } from '../src/queries/audit';
import { createDocument, issueVersion } from '../src/documents/build';
import { renderDocumentHtml } from '../src/documents/render';
import { recordVisit } from '../src/service/record';
import { uninvoicedEvents, submitInvoice } from '../src/billing/invoice';
import { mkdirSync, writeFileSync } from 'node:fs';
import { synthUnits, synthAutoAudit, synthCim, synthPsr, SYNTH_CLASS_ID, SYNTH_NAME } from '../src/dev/synthetic';

const i = process.argv.indexOf('--data');
const db = await openDb(i >= 0 ? process.argv[i + 1] : undefined);

const units = synthUnits();
const pid = (await db.query<{ id: string }>(
  `INSERT INTO property (class_id,name,address) VALUES ($1,$2,'1 Synthetic Way') ON CONFLICT (class_id) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
  [SYNTH_CLASS_ID, SYNTH_NAME])).rows[0].id;

const psr = await importParsed(db, pid, parsePsr(synthPsr(units)), { createMissing: true });
const audit = await importParsed(db, pid, parseAutoAudit(synthAutoAudit(units)), { createMissing: true });
const cim = await importParsed(db, pid, parseCimNextCentury(synthCim(units)));

const lines = await auditLines(db, audit.batchId!, '2026-11-06');
const todo = needsAction(lines);
console.log(`Property ${SYNTH_NAME} (${SYNTH_CLASS_ID}): ${units.length} units`);
console.log(`PSR      devices ${psr.devices}, install warranty anchored`);
console.log(`Audit    readings ${audit.readings}, occupancy ${audit.occupancyUpdated}, ID changes ${audit.idChanges.length}`);
console.log(`CIM      check-ins ${cim.checkins}, unmatched ${cim.unmatched.length}, ID changes ${cim.idChanges.length}`);
console.log(`Review   ${todo.length} of ${lines.length} lines need action`);
for (const l of todo.slice(0, 8)) console.log(`   ${l.building}-${l.unit}  ${l.code.padEnd(5)} ${l.recommendation.action}${l.recommendation.owner ? ` (${l.recommendation.owner})` : ''}  labor covered: ${l.coverage.laborCovered}`);

// ---- Phase 2: catalog, clauses, a visit, a Work Authorization, and an invoice ----
await db.query(`INSERT INTO catalog_item (name,kind,component,price,effective_from) VALUES
  ('Transmitter (water)','part','transmitter',85.00,'2026-01-01'), ('Water meter','part','meter',140.00,'2026-01-01'), ('Labor, per visit','labor',NULL,125.00,'2026-01-01')`);
// Standard clauses come from migration 008.

const first = todo.find((l) => l.recommendation.action === 'Needs Service') ?? todo[0];
if (first) {
  await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-04', outcome: 'completed', technician: 'Demo Tech', salesforceCase: '00000001',
    events: [{ endpointId: first.endpointId, action: 'inspect_test', issueCode: first.code, notes: 'Synthetic demo visit' }] });
}
const doc = await createDocument(db, { propertyId: pid, type: 'WA', title: 'Meter system repairs', createdOn: '2026-11-06', fromAuditBatch: audit.batchId!, salesforceCase: '00000002' });
const issued = await issueVersion(db, doc.versionId, null, '2026-11-06');
console.log(`WA       ${doc.number}: ${doc.lines} lines, valid until ${issued.content.quoteValidUntil}, missing merge fields ${issued.missingFields.length}`);
const open = await uninvoicedEvents(db, pid);
if (open.length) {
  const inv = await submitInvoice(db, { propertyId: pid, submittedOn: '2026-11-06', items: [{ eventId: open[0].eventId, laborAmount: 125 }] });
  console.log(`Invoice  ${inv.lines} line(s), ${inv.billable} billable, total ${inv.total}`);
}
const oi = process.argv.indexOf('--out');
if (oi >= 0) {
  const dir = process.argv[oi + 1];
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${doc.number}-client.html`, renderDocumentHtml(issued.content, 'client'));
  writeFileSync(`${dir}/${doc.number}-tech.html`, renderDocumentHtml(issued.content, 'tech'));
  console.log(`Wrote client and technician copies to ${dir}`);
}
await db.close();
