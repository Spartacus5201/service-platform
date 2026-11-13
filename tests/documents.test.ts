import { describe, it, expect } from 'vitest';
import { world, count } from './helpers';
import {
  nextDocumentNumber, createDocument, addLine, updateLine, issueVersion, newVersion, quoteStatus, reconfirmPricing, DocumentError,
} from '../src/documents/build';
import { mergeFields, renderDocumentHtml, documentTotal } from '../src/documents/render';

async function catalog(db: Awaited<ReturnType<typeof world>>['db']) {
  await db.query(`INSERT INTO catalog_item (name,kind,component,price,effective_from) VALUES ('Transmitter','part','transmitter',85.00,'2026-01-01'),('Meter','part','meter',140.00,'2026-01-01'),('Labor, per visit','labor',NULL,125.00,'2026-01-01')`);
}

describe('numbering', () => {
  it('is ClassID-YYMMDD, with -2 and -3 on the same day', async () => {
    const { db, pid } = await world();
    expect(await nextDocumentNumber(db, '1001001', '2026-11-05')).toBe('1001001-261105');
    const a = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-05' });
    const b = await createDocument(db, { propertyId: pid, type: 'RFM', createdOn: '2026-11-05' });
    const c = await createDocument(db, { propertyId: pid, type: 'Proposal', createdOn: '2026-11-05' });
    const d = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06' });
    expect([a.number, b.number, c.number, d.number]).toEqual(['9900001-261105', '9900001-261105-2', '9900001-261105-3', '9900001-261106']);
  });
});

describe('building from an audit', () => {
  it('makes a line per Needs Service / Investigate row, priced from the catalog', async () => {
    const { db, pid, batchId } = await world();
    await catalog(db);
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', title: 'Test repairs', createdOn: '2026-11-06', fromAuditBatch: batchId });
    expect(doc.lines).toBe(4);                                              // NT, HIGH, LOW, unrecognized (NI is vacant)
    const l = await db.query<{ issue_code: string; unit_price: string | null; include: boolean; component: string | null }>(
      `SELECT issue_code, unit_price::text, include, component FROM document_line WHERE version_id=$1 ORDER BY issue_code`, [doc.versionId]);
    const by = Object.fromEntries(l.rows.map((x) => [x.issue_code, x]));
    expect(by.NT).toMatchObject({ unit_price: '85.00', include: true, component: 'transmitter' });
    expect(by.HIGH.unit_price).toBeNull();                                   // Investigate is not a part sale until decided
    expect(by.ZZ.include).toBe(false);                                      // unrecognized codes are not auto-included
  });

  it('marks install-warranty lines as covered', async () => {
    const { db, pid, batchId } = await world({ installedByUs: true });
    await catalog(db);
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06', fromAuditBatch: batchId });
    expect(await count(db, `SELECT count(*)::text n FROM document_line WHERE version_id=$1 AND part_covered AND labor_covered`, [doc.versionId])).toBe(4);
  });

  it('only a Proposal can act as another type', async () => {
    const { db, pid } = await world();
    await expect(createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06', actsAs: ['RFM'] })).rejects.toThrow(DocumentError);
    const p = await createDocument(db, { propertyId: pid, type: 'Proposal', createdOn: '2026-11-06', actsAs: ['WA', 'RFM'] });
    expect(p.documentId).toBeTruthy();
  });
});

describe('versions', () => {
  it('issuing freezes the version and starts the 30-day quote window', async () => {
    const { db, pid, batchId } = await world();
    await catalog(db);
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06', fromAuditBatch: batchId });
    const r = await issueVersion(db, doc.versionId, null, '2026-11-06');
    expect(r.content.quoteValidUntil).toBe('2026-12-06');
    expect(r.content.lines.length).toBe(4);
    await expect(addLine(db, doc.versionId, { description: 'late' })).rejects.toThrow(/locked/);
    const line = (await db.query<{ id: string }>(`SELECT id FROM document_line WHERE version_id=$1 LIMIT 1`, [doc.versionId])).rows[0].id;
    await expect(updateLine(db, line, { quantity: 9 })).rejects.toThrow(/locked/);
  });

  it('a new version copies the lines and keeps the original quote window', async () => {
    const { db, pid, batchId } = await world();
    await catalog(db);
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06', fromAuditBatch: batchId });
    await issueVersion(db, doc.versionId, null, '2026-11-06');
    const v2 = await newVersion(db, doc.documentId);
    await expect(newVersion(db, doc.documentId)).rejects.toThrow(/still a draft/);
    const first = (await db.query<{ id: string }>(`SELECT id FROM document_line WHERE version_id=$1 LIMIT 1`, [v2])).rows[0].id;
    await updateLine(db, first, { include: false });
    const r2 = await issueVersion(db, v2, null, '2026-11-20');
    expect(r2.content.version).toBe(2);
    expect(r2.content.quoteValidUntil).toBe('2026-12-06');                  // not restarted
    expect(r2.content.lines.filter((l) => l.include).length).toBe(2);   // 3 included from the audit, minus the one dropped
    // version 1 is untouched
    const v1 = (await db.query<{ frozen_content: { lines: unknown[] } }>(`SELECT frozen_content FROM document_version WHERE id=$1`, [doc.versionId])).rows[0];
    expect(v1.frozen_content.lines.length).toBe(4);
  });

  it('refuses to issue an empty document', async () => {
    const { db, pid } = await world();
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06' });
    await expect(issueVersion(db, doc.versionId, null, '2026-11-06')).rejects.toThrow(/Nothing is included/);
  });
});

describe('quote validity', () => {
  it('valid for 30 days, then expired until pricing is reconfirmed; approval stays possible', async () => {
    const { db, pid } = await world();
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06' });
    await addLine(db, doc.versionId, { description: 'Replace transmitter', unitPrice: 85 });
    await issueVersion(db, doc.versionId, null, '2026-11-06');
    expect(await quoteStatus(db, doc.documentId, '2026-12-06')).toBe('valid');
    expect(await quoteStatus(db, doc.documentId, '2026-12-07')).toBe('expired');
    await expect(reconfirmPricing(db, doc.documentId, '00000000-0000-0000-0000-000000000001', '2026-12-01')).rejects.toThrow(/still valid/);
    await reconfirmPricing(db, doc.documentId, '00000000-0000-0000-0000-000000000001', '2027-01-15');
    expect(await quoteStatus(db, doc.documentId, '2027-01-15')).toBe('reconfirmed');
  });
  it('RFMs have no quote window', async () => {
    const { db, pid } = await world();
    const doc = await createDocument(db, { propertyId: pid, type: 'RFM', createdOn: '2026-11-06' });
    await addLine(db, doc.versionId, { description: '10 transmitters', quantity: 10, unitPrice: 85 });
    const r = await issueVersion(db, doc.versionId, null, '2026-11-06');
    expect(r.content.quoteValidUntil).toBeNull();
    expect(await quoteStatus(db, doc.documentId, '2030-01-01')).toBe('not_applicable');
  });
});

describe('unit address on the document', () => {
  it('shows the street address beside the building and unit, on both copies', async () => {
    const { db, pid, batchId } = await world();
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06', fromAuditBatch: batchId });
    const r = await issueVersion(db, doc.versionId, null, '2026-11-06');
    const nt = r.content.lines.find((l) => l.issueCode === 'NT')!;
    expect(nt.address).toBe('1 TEST ROAD APT 102');
    expect(renderDocumentHtml(r.content, 'client')).toContain('1 TEST ROAD APT 102');
    expect(renderDocumentHtml(r.content, 'tech')).toContain('1 TEST ROAD APT 102');
  });
});

describe('clauses and rendering', () => {
  it('merges fields and reports the ones it cannot fill', () => {
    const m = mergeFields('Work at {{property.name}} under {{document.number}}; PO {{po.number}}.', { property: { name: 'Test' }, document: { number: 'X-1' } });
    expect(m.text).toBe('Work at Test under X-1; PO [[missing: po.number]].');
    expect(m.missing).toEqual(['po.number']);
  });

  it('applies clauses by document type and keeps the audience split', async () => {
    const { db, pid } = await world();
    await db.query(`DELETE FROM clause_template`);
    await db.query(`INSERT INTO clause_template (key,title,body,applies_when) VALUES
      ('scope','Scope','Service at {{property.name}} per {{document.number}}.','{"types":["WA","Proposal"]}'),
      ('terms','Terms','Valid until {{document.quoteValidUntil}}. Net 30.','{"types":["Proposal","WA"],"audience":"client"}'),
      ('rfm','Material','Material only; no warranty.','{"types":["RFM"]}')`);
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06', title: 'Repairs' });
    await addLine(db, doc.versionId, { description: 'Replace transmitter', quantity: 2, unitPrice: 85, issueCode: 'NT' });
    const r = await issueVersion(db, doc.versionId, null, '2026-11-06');
    expect(r.content.clauses.map((c) => c.key)).toEqual(['scope', 'terms']);
    expect(r.content.clauses[0].body).toBe('Service at Test Property per 9900001-261106.');
    expect(r.missingFields).toEqual([]);
    expect(documentTotal(r.content)).toBe(170);
    const client = renderDocumentHtml(r.content, 'client');
    expect(client).toContain('<th>Work</th>');
    expect(client).toContain('$170.00');
    expect(client).toContain('Net 30');
  });

  it('the technician copy carries no prices, totals, or client-only clauses', async () => {
    const { db, pid } = await world();
    await db.query(`UPDATE property SET access_notes='Gate code at office' WHERE id=$1`, [pid]);
    await db.query(`DELETE FROM clause_template`);
    await db.query(`INSERT INTO clause_template (key,title,body,applies_when) VALUES ('terms','Terms','Net 30 at $85 per unit.','{"audience":"client"}')`);
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06' });
    await addLine(db, doc.versionId, { description: 'Replace transmitter', unitPrice: 85.5, issueCode: 'NT' });
    const r = await issueVersion(db, doc.versionId, null, '2026-11-06');
    const tech = renderDocumentHtml(r.content, 'tech');
    expect(tech).toContain('Replace transmitter');
    expect(tech).toContain('Gate code at office');
    expect(tech).not.toMatch(/85\.5|\$|Total|Net 30|Price|Amount/);
  });

  it('escapes text from the database', async () => {
    const { db, pid } = await world();
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06' });
    await addLine(db, doc.versionId, { description: '<script>alert(1)</script>', unitPrice: 1 });
    const r = await issueVersion(db, doc.versionId, null, '2026-11-06');
    expect(renderDocumentHtml(r.content, 'client')).not.toContain('<script>');
  });

  it('part-warranty lines bill at zero', async () => {
    const { db, pid } = await world();
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-06' });
    await addLine(db, doc.versionId, { description: 'Covered transmitter', unitPrice: 85, partCovered: true, laborCovered: true });
    await addLine(db, doc.versionId, { description: 'Billable meter', unitPrice: 140 });
    const r = await issueVersion(db, doc.versionId, null, '2026-11-06');
    expect(documentTotal(r.content)).toBe(140);
  });
});

describe('labor charge', () => {
  it('defaults to the labor_rate setting, can be overridden, and is zeroed by warranty', async () => {
    const { laborRate } = await import('../src/documents/build');
    const { lineTotal } = await import('../src/documents/render');
    const { db } = await world();
    expect(await laborRate(db)).toBe(85);
    await db.query(`UPDATE setting SET value='90' WHERE key='labor_rate'`);
    expect(await laborRate(db)).toBe(90);
    const base = { building: null, unit: null, address: null, service: null, issueCode: null, description: 'x', component: null, quantity: 2, unitPrice: 100, laborPrice: 85, laborCovered: false, partCovered: false, include: true };
    expect(lineTotal(base)).toBe(370);
    expect(lineTotal({ ...base, laborCovered: true })).toBe(200);
    expect(lineTotal({ ...base, partCovered: true })).toBe(0);
    expect(lineTotal({ ...base, laborPrice: 60 })).toBe(320);
    expect(lineTotal({ ...base, unitPrice: null })).toBe(170);
  });
});

describe('invoicing codes', () => {
  it('uses 262000000 under install warranty, 262000001 with no contract, else the ClassID', async () => {
    const { invoicingFor } = await import('../src/documents/build');
    const { db, pid } = await world();
    expect(await invoicingFor(db, pid, '2026-11-05')).toMatchObject({ code: '9900001', chargeCode: '20' });
    await db.query(`UPDATE property SET installed_by_us=true, install_completed_on='2026-03-12' WHERE id=$1`, [pid]);
    expect(await invoicingFor(db, pid, '2026-11-05')).toEqual({ code: '262000000', chargeCode: '23' });
    expect(await invoicingFor(db, pid, '2027-06-01')).toMatchObject({ code: '9900001' });
    await db.query(`UPDATE property SET billing_contract=false WHERE id=$1`, [pid]);
    expect(await invoicingFor(db, pid, '2027-06-01')).toEqual({ code: '272000001', chargeCode: '20' });
    const d = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-05' });
    expect(d.number).toBe('262000000-261105');
    expect((await db.query<{ charge_code: string }>(`SELECT charge_code FROM document WHERE id=$1`, [d.documentId])).rows[0].charge_code).toBe('23');
  });
});
