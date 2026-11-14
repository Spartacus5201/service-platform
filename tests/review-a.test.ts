// Code review group A (docs/REVIEW-2026-11.md): money, warranty and records. Each test failed before its fix.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { world, count } from './helpers';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { parsePsr } from '../src/parsers/psr';
import { autoAuditGrid, psrSheets, CLASS_ID } from './fixtures';
import { recordVisit } from '../src/service/record';
import { voidEvent, correctVisit, correctEventWithReason } from '../src/service/correct';
import { createDocument } from '../src/documents/build';
import { uninvoicedEvents, submitInvoice } from '../src/billing/invoice';
import { createJob, jobDetail } from '../src/jobs/jobs';
import { importInventory } from '../src/catalog/import';
import { batteryFor } from '../src/service/battery';

describe('review A: warranty', () => {
  it('A1: a voided swap gives no warranty, and a transmitter swap does not cover the meter', async () => {
    const db = await openDb();
    const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'P') RETURNING id`, [CLASS_ID])).rows[0].id;
    const r = await importParsed(db, pid, parseAutoAudit(autoAuditGrid([{ bldg: '1', unit: '102', code: 'NT', occ: '05/10/25-01/01/00' }, { bldg: '1', unit: '105', code: 'NI', occ: '05/10/25-01/01/00' }])), { createMissing: true });
    const ep = async (u: string) => (await db.query<{ id: string }>(`SELECT e.id FROM endpoint e JOIN unit u ON u.id=e.unit_id WHERE ltrim(u.current_label,'0')=$1`, [u])).rows[0].id;
    await recordVisit(db, { propertyId: pid, visitedOn: '2026-09-01', outcome: 'completed', events: [{ endpointId: await ep('105'), action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX105' }] }] });
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-09-01', outcome: 'completed', events: [{ endpointId: await ep('102'), action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX102' }] }] });
    await voidEvent(db, v.eventIds[0], 'entered on the wrong unit', null);
    await db.query(`INSERT INTO catalog_item (name,kind,component,price,effective_from) VALUES ('Meter','part','meter',120,'2026-01-01'),('TX','part','transmitter',80,'2026-01-01')`);
    const d = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-13', fromAuditBatch: r.batchId! });
    const lines = (await db.query<{ unit: string; labor_covered: boolean; part_covered: boolean }>(
      `SELECT ltrim(u.current_label,'0') unit, l.labor_covered, l.part_covered FROM document_line l JOIN endpoint e ON e.id=l.endpoint_id JOIN unit u ON u.id=e.unit_id WHERE l.version_id=$1 ORDER BY 1`, [d.versionId])).rows;
    expect(lines.find((l) => l.unit === '102')).toMatchObject({ labor_covered: false, part_covered: false });   // voided: no history
    expect(lines.find((l) => l.unit === '105')).toMatchObject({ labor_covered: true, part_covered: false });    // labor from the visit, but the meter was never replaced
  }, 60000);

  it('A2: a unit marked unable to access on a completed visit starts no labor warranty', async () => {
    const w = await world();
    await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-03-01', outcome: 'completed', events: [{ endpointId: await w.ep('101'), action: 'repair', result: 'repaired' }, { endpointId: await w.ep('102'), action: 'inspect_test', result: 'unable_to_access' }] });
    const b = await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-06-01', outcome: 'completed', events: [{ endpointId: await w.ep('102'), action: 'repair', result: 'repaired' }] });
    expect((await w.db.query<{ labor_covered: boolean }>(`SELECT labor_covered FROM service_event WHERE id=$1`, [b.eventIds[0]])).rows[0].labor_covered).toBe(false);
  }, 60000);

  it('A3: correcting or voiding an earlier visit recalculates later ones', async () => {
    const w = await world();
    const e102 = await w.ep('102'); const e104 = await w.ep('104');
    const a = await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-03-01', outcome: 'completed', events: [{ endpointId: e102, action: 'repair' }, { endpointId: e104, action: 'repair' }] });
    await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-06-01', outcome: 'completed', events: [{ endpointId: e102, action: 'repair' }, { endpointId: e104, action: 'repair' }] });
    expect((await uninvoicedEvents(w.db, w.pid)).filter((x) => x.visitedOn === '2026-06-01').every((x) => x.laborCovered)).toBe(true);
    await correctVisit(w.db, a.visitId, { outcome: 'unable_to_access' }, 'tech could not get in', null);
    expect((await uninvoicedEvents(w.db, w.pid)).filter((x) => x.visitedOn === '2026-06-01').map((x) => x.laborCovered)).toEqual([false, false]);
  }, 60000);

  it('A3: changing a unit result to unable to access, and voiding, also recalculate later visits', async () => {
    const w = await world();
    const e102 = await w.ep('102');
    const a = await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-03-01', outcome: 'completed', events: [{ endpointId: e102, action: 'repair', result: 'repaired' }] });
    const b = await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-06-01', outcome: 'completed', events: [{ endpointId: e102, action: 'repair' }] });
    const covered = async () => (await w.db.query<{ labor_covered: boolean }>(`SELECT se.labor_covered FROM service_event se WHERE se.visit_id=$1 AND NOT se.voided AND NOT EXISTS (SELECT 1 FROM service_event s2 WHERE s2.supersedes=se.id)`, [b.visitId])).rows[0].labor_covered;
    expect(await covered()).toBe(true);
    const next = await correctEventWithReason(w.db, a.eventIds[0], { result: 'unable_to_access' }, 'locked out', null);
    expect(await covered()).toBe(false);
    await correctEventWithReason(w.db, next, { result: 'repaired' }, 'was fixed after all', null);
    expect(await covered()).toBe(true);
    const live = (await w.db.query<{ id: string }>(`SELECT se.id FROM service_event se WHERE se.visit_id=$1 AND NOT EXISTS (SELECT 1 FROM service_event s2 WHERE s2.supersedes=se.id)`, [a.visitId])).rows[0].id;
    await voidEvent(w.db, live, 'never happened', null);
    expect(await covered()).toBe(false);
  }, 60000);

  it('A3: a back-dated visit recalculates later visits', async () => {
    const w = await world();
    const b = await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-06-01', outcome: 'completed', events: [{ endpointId: await w.ep('102'), action: 'repair' }] });
    expect((await w.db.query<{ labor_covered: boolean }>(`SELECT labor_covered FROM service_event WHERE id=$1`, [b.eventIds[0]])).rows[0].labor_covered).toBe(false);
    await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-03-01', outcome: 'completed', events: [{ endpointId: await w.ep('102'), action: 'repair' }] });
    expect((await w.db.query<{ labor_covered: boolean }>(`SELECT labor_covered FROM service_event WHERE id=$1`, [b.eventIds[0]])).rows[0].labor_covered).toBe(true);
  }, 60000);
});

describe('review A: records', () => {
  it('A4: two corrections of the same entry at once: only one stands', async () => {
    const w = await world();
    const v = await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-11-05', outcome: 'completed', events: [{ endpointId: await w.ep('102'), action: 'repair', notes: 'orig' }] });
    const r = await Promise.allSettled([
      correctEventWithReason(w.db, v.eventIds[0], { notes: 'user A fix' }, 'typo', null),
      correctEventWithReason(w.db, v.eventIds[0], { readAtService: 1234 }, 'read', null),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await uninvoicedEvents(w.db, w.pid)).toHaveLength(1);
  }, 60000);

  it('A11: a document cannot be drafted from another property\'s audit', async () => {
    const w = await world();
    const other = (await w.db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ('9999999','Other') RETURNING id`)).rows[0].id;
    await expect(createDocument(w.db, { propertyId: other, type: 'WA', createdOn: '2026-11-13', fromAuditBatch: w.batchId })).rejects.toThrow(/another property/);
  }, 60000);

  it('A10: an older PSR never moves the install warranty start back', async () => {
    const w = await world({ installedByUs: true });
    const on = async () => (await w.db.query<{ d: string }>(`SELECT install_completed_on::text d FROM property WHERE id=$1`, [w.pid])).rows[0].d;
    const first = await on();
    const older = parsePsr(psrSheets()); older.completedOn = '2020-01-01';
    await importParsed(w.db, w.pid, older, { allowClassMismatch: true });
    expect(await on()).toBe(first);
  }, 60000);
});

describe('review A: money', () => {
  it('A6: job money counts parts invoiced and a Proposal\'s shipping', async () => {
    const w = await world();
    const job = await createJob(w.db, { propertyId: w.pid, title: 'J', requestedOn: '2026-11-01' });
    const cat = (await w.db.query<{ id: string }>(`INSERT INTO catalog_item (name,kind,component,price) VALUES ('TX','part','transmitter',80) RETURNING id`)).rows[0].id;
    const v = await recordVisit(w.db, { propertyId: w.pid, jobId: job, visitedOn: '2026-11-05', outcome: 'completed', events: [{ endpointId: await w.ep('102'), action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'NEW1', catalogItemId: cat }] }] });
    const part = (await w.db.query<{ id: string }>(`SELECT id FROM event_part WHERE service_event_id=$1`, [v.eventIds[0]])).rows[0].id;
    await submitInvoice(w.db, { propertyId: w.pid, submittedOn: '2026-11-10', items: [{ eventId: v.eventIds[0], laborAmount: 85, partAmounts: { [part]: 80 } }] });
    const p = await createDocument(w.db, { propertyId: w.pid, type: 'Proposal', createdOn: '2026-11-02', jobId: job });
    await w.db.query(`INSERT INTO document_line (version_id,description,quantity,unit_price,labor_price,include) VALUES ($1,'Transmitter',2,80,85,true)`, [p.versionId]);
    await w.db.query(`UPDATE document SET shipping=25 WHERE id=$1`, [p.documentId]);
    const d = await jobDetail(w.db, job);
    expect(d!.money.invoiced).toBe(165);
    expect(d!.documents.find((x) => x.id === p.documentId)!.quoted).toBe(2 * 80 + 2 * 85 + 25);   // labor is per unit, as on the document
  }, 60000);

  it('A8: an obsolete or repriced part never falls back to an older price', async () => {
    const book = async (price: number, cv: string) => { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Inventory');
      ws.addRow(['Part Type', 'Description', 'Part#', 'Sell Price', 'Cost Verified']); ws.addRow(['Battery', 'TR4 battery', 'B-1', price, cv]);
      return new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer); };
    const db = await openDb();
    await importInventory(db, await book(12, ''), '2026-01-01', true);
    await importInventory(db, await book(15, 'OBSOLETE'), '2026-06-01', true);
    expect(await count(db, `SELECT count(*) n FROM catalog_item WHERE active`)).toBe(0);
    expect((await batteryFor(db, 'TR4', '2026-11-13')).price).toBe(9.1);                 // default, not the old $12
    await importInventory(db, await book(15, ''), '2026-07-01', true);                    // back in use
    expect((await batteryFor(db, 'TR4', '2026-11-13')).price).toBe(15);
  }, 60000);
});
