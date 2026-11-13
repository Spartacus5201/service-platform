import { describe, it, expect } from 'vitest';
import { renderPdf } from '../src/documents/pdf';
import type { FrozenContent } from '../src/documents/render';
import { world } from './helpers';
import { createDocument, issueVersion, getPdf } from '../src/documents/build';

const base = (n: number): FrozenContent => ({
  number: '9900001-261110', type: 'WA', actsAs: null, title: 'Project é', version: 1, issuedOn: '2026-11-10', quoteValidUntil: '2026-12-10',
  property: { name: 'Synthetic Gardens', classId: '9900001', address: '1 Synthetic Way', accessNotes: 'Gate code 1234', schedulingNotes: null },
  salesforceCase: '500XYZ', salesforceWorkOrder: null,
  clauses: [{ key: 'a', title: 'Terms', body: 'Valid 30 days.' }, { key: 'b', title: 'Client only', body: 'Pay us.', audience: 'client' }],
  lines: Array.from({ length: n }, (_, i) => ({ building: '1', unit: String(100 + i), address: `1 SYNTHETIC WAY # ${100 + i}`, service: 'WS', issueCode: 'NT', description: 'Replace transmitter 日本', component: 'transmitter', quantity: 1, unitPrice: 85, laborCovered: false, partCovered: false, include: true })),
});
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');

describe('PDF copies', () => {
  it('produces a valid multi-page PDF for a long document', async () => {
    const b = await renderPdf(base(60), 'client');
    expect(text(b).startsWith('%PDF-')).toBe(true);
    expect((text(b).match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
  it('technician copy is smaller than the client copy (no price columns, no client-only clause)', async () => {
    const c = await renderPdf(base(5), 'client'); const tch = await renderPdf(base(5), 'tech');
    expect(tch.length).toBeLessThan(c.length);
  });
  it('stores both PDFs when a version is issued and can fetch them', async () => {
    const w = await world(); await w.db.query(`INSERT INTO catalog_item (name,kind,component,price,effective_from) VALUES ('T','part','transmitter',85,'2026-01-01')`);
    const d = await createDocument(w.db, { propertyId: w.pid, type: 'WA', createdOn: '2026-11-10', fromAuditBatch: w.batchId });
    await issueVersion(w.db, d.versionId, null, '2026-11-10');
    const row = (await w.db.query<{ c: number; t: number }>(`SELECT length(client_pdf) c, length(tech_pdf) t FROM document_version WHERE id=$1`, [d.versionId])).rows[0];
    expect(row.c).toBeGreaterThan(500); expect(row.t).toBeGreaterThan(500);
    const got = await getPdf(w.db, d.documentId, 1, 'tech');
    expect(got?.number).toBe(d.number); expect(text(got!.bytes).startsWith('%PDF-')).toBe(true);
  }, 60000);
});
