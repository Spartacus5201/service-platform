// Local-only end-to-end smoke test on real files, in memory (nothing persisted). Prints counts only.
// Usage: npx tsx scripts/smoke-real.ts <occupancy-or-audit.xlsx> [cim.xlsx]
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db';
import { parseFile } from '../src/parsers';
import { importParsed } from '../src/import/commit';
import { auditLines, needsAction } from '../src/queries/audit';

const [auditPath, cimPath] = process.argv.slice(2);
const db = await openDb();
const a = await parseFile(readFileSync(auditPath));
if (!('rows' in a)) throw new Error('first file must be an audit');
const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'(local smoke test)') RETURNING id`, [a.classId!.trim()])).rows[0].id;
const occ = await importParsed(db, pid, a, { createMissing: true, as: 'occupancy', fileBytes: readFileSync(auditPath) });
console.log('occupancy import', { units: occ.unitsCreated, occupancyUpdated: occ.occupancyUpdated, readings: occ.readings, unmatched: occ.unmatched.length });
const au = await importParsed(db, pid, a, { fileBytes: readFileSync(auditPath) });
const lines = await auditLines(db, au.batchId!, new Date().toISOString().slice(0, 10));
const tally: Record<string, number> = {};
lines.forEach((l) => (tally[`${l.code}->${l.recommendation.action}`] = (tally[`${l.code}->${l.recommendation.action}`] ?? 0) + 1));
console.log('audit import', { readings: au.readings, needsAction: needsAction(lines).length, tally, idChanges: au.idChanges.length });
if (cimPath) {
  const c = await parseFile(readFileSync(cimPath));
  if ('devices' in c) {
    const r = await importParsed(db, pid, c, {});
    console.log('cim import', { devices: c.devices.length, checkins: r.checkins, unmatched: r.unmatched.length, idChanges: r.idChanges.length });
  }
}
