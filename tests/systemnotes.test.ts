import { describe, it, expect } from 'vitest';
import { world } from './helpers';
import { createDocument, issueVersion, invoicingFor } from '../src/documents/build';
import { bringList, getPropertyPrices, getSystemNotes, parseEquipment, saveSystemNotes, EMPTY_NOTES } from '../src/documents/systemnotes';
import { renderDocumentHtml } from '../src/documents/render';
import { renderPdf } from '../src/documents/pdf';
import { auditLines } from '../src/queries/audit';
import { setOverride } from '../src/review/overrides';

async function catalog(db: Awaited<ReturnType<typeof world>>['db']) {
  await db.query(`INSERT INTO catalog_item (name,kind,component,price,effective_from) VALUES ('Transmitter','part','transmitter',85.00,'2026-01-01'),('Meter','part','meter',140.00,'2026-01-01')`);
}

describe('WA Notes', () => {
  it('saves and reads back notes, prices and the MSA flag', async () => {
    const { db, pid } = await world();
    await saveSystemNotes(db, pid, { ...EMPTY_NOTES, utilities: [{ utility: 'Water', device: 'MM FAM' }], systemBrand: 'Inovonics', systemId: 'TW.com YR6PH5TP', collectorLocation: 'Leasing office IT closet',
      milestoneKind: 'Takeover', milestoneOn: '2023-06-28', techNote: 'Check wiring.', transmitterDevice: 'Inovonics Transmitter', equipment: [{ qty: 1, device: 'Programmer' }] }, { Labor: 85, Transmitter: 66.5 }, true, null);
    const n = await getSystemNotes(db, pid);
    expect(n).toMatchObject({ systemBrand: 'Inovonics', milestoneKind: 'Takeover', milestoneOn: '2023-06-28', techNote: 'Check wiring.' });
    expect(n.utilities).toEqual([{ utility: 'Water', device: 'MM FAM' }]);
    expect(await getPropertyPrices(db, pid)).toEqual({ Labor: 85, Transmitter: 66.5 });
    expect((await invoicingFor(db, pid, '2026-11-06')).chargeCode).toBe('21');
    await saveSystemNotes(db, pid, n, {}, false, null);               // saving replaces the prices
    expect(await getPropertyPrices(db, pid)).toEqual({});
  });

  it('refuses bad prices and quantities', async () => {
    const { db, pid } = await world();
    await expect(saveSystemNotes(db, pid, EMPTY_NOTES, { Transmitter: -1 }, false, null)).rejects.toThrow(/dollar amount/);
    await expect(saveSystemNotes(db, pid, EMPTY_NOTES, { Gizmo: 5 }, false, null)).rejects.toThrow(/dollar amount/);
    await expect(saveSystemNotes(db, pid, { ...EMPTY_NOTES, equipment: [{ qty: 0, device: 'x' }] }, {}, false, null)).rejects.toThrow(/whole numbers/);
  });

  it('parses equipment lines and builds the bring list from the document', () => {
    expect(parseEquipment('35 | Zenner ETR-U\n1 Programmer\nTape')).toEqual([{ qty: 35, device: 'Zenner ETR-U' }, { qty: 1, device: 'Programmer' }, { qty: 1, device: 'Tape' }]);
    const bring = bringList({ ...EMPTY_NOTES, transmitterDevice: 'Inovonics Transmitter', equipment: [{ qty: 1, device: 'Programmer' }] },
      [{ component: 'transmitter', quantity: 29, include: true }, { component: 'meter', quantity: 5, include: true }, { component: 'transmitter', quantity: 9, include: false }]);
    expect(bring).toEqual([{ qty: 29, device: 'Inovonics Transmitter' }, { qty: 5, device: 'Meter' }, { qty: 1, device: 'Programmer' }]);
  });

  it('a property price replaces the catalog price and the default labor on new documents, and shows only on the technician copy', async () => {
    const { db, pid, batchId } = await world();
    await catalog(db);
    await saveSystemNotes(db, pid, { ...EMPTY_NOTES, techNote: 'Verify incrementing before leaving each unit.', transmitterDevice: 'Inovonics Transmitter' }, { Transmitter: 66.5, Labor: 90 }, false, null);
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06', fromAuditBatch: batchId });
    const l = await db.query<{ issue_code: string; unit_price: string | null; labor_price: string | null; description: string }>(`SELECT issue_code, unit_price::text, labor_price::text, description FROM document_line WHERE version_id=$1`, [doc.versionId]);
    const nt = l.rows.find((x) => x.issue_code === 'NT')!;
    expect(nt).toMatchObject({ unit_price: '66.50', labor_price: '90.00', description: 'Meter Service - Non-Transmitting' });
    const r = await issueVersion(db, doc.versionId, null, '2026-11-06');
    expect(r.content.systemNotes?.bring[0]).toEqual({ qty: 1, device: 'Inovonics Transmitter' });
    expect(renderDocumentHtml(r.content, 'tech')).toContain('Verify incrementing');
    expect(renderDocumentHtml(r.content, 'client')).not.toContain('Verify incrementing');
    expect(Buffer.from(await renderPdf(r.content, 'tech')).length).toBeGreaterThan(1000);
  });

  it('a property request becomes an unpriced inspection line', async () => {
    const { db, pid, batchId } = await world();
    await catalog(db);
    const lines = await auditLines(db, batchId, '2026-11-06');
    const ok = lines.find((l) => l.code === 'OK')!;
    await setOverride(db, ok.readingId, { action: 'Requested by property', reason: 'Resident complains of high bills' }, null, ok.rules);
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06', fromAuditBatch: batchId });
    const r = await db.query<{ description: string; unit_price: string | null; labor_price: string | null }>(`SELECT description, unit_price::text, labor_price::text FROM document_line WHERE version_id=$1 AND audit_reading_id=$2`, [doc.versionId, ok.readingId]);
    expect(r.rows).toEqual([{ description: 'Inspection / usage accuracy test (requested by property)', unit_price: null, labor_price: null }]);
  });
});
