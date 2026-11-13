import { describe, it, expect } from 'vitest';
import { groupWork, totals, unitRows, bySlot, invoicingCode } from '../src/documents/layout';
import { renderDocumentHtml, type FrozenContent, type FrozenLine } from '../src/documents/render';
import { renderPdf } from '../src/documents/pdf';

const L = (o: Partial<FrozenLine> = {}): FrozenLine => ({ building: '1', unit: '101', address: '1 A ST # 101', service: 'WS', issueCode: 'NT', description: 'Replace transmitter', component: 'transmitter',
  quantity: 1, unitPrice: 85, laborPrice: 85, laborCovered: false, partCovered: false, include: true, ...o });
const C = (lines: FrozenLine[], o: Partial<FrozenContent> = {}): FrozenContent => ({ number: '9900001-261110', type: 'WA', actsAs: null, title: null, version: 1, issuedOn: '2026-11-10', quoteValidUntil: '2026-12-10',
  property: { name: 'P', classId: '9900001', address: '1 A St', accessNotes: null, schedulingNotes: null }, salesforceCase: null, salesforceWorkOrder: null, clauses: [], lines, ...o });

describe('document layout', () => {
  it('groups identical work into one row with a quantity and keeps different prices apart', () => {
    const g = groupWork([L({ unit: '101' }), L({ unit: '102' }), L({ unit: '103', laborPrice: 100 }), L({ unit: '104', include: false })]);
    expect(g.map((x) => [x.quantity, x.laborPrice, x.total])).toEqual([[2, 85, 340], [1, 100, 185]]);
  });
  it('zeroes warranty-covered work inside a group', () => {
    const g = groupWork([L({ laborCovered: true }), L({ unit: '102', laborCovered: true })]);
    expect(g[0]).toMatchObject({ quantity: 2, coverage: 'Labor under warranty', laborTotal: 0, partTotal: 170, total: 170 });
  });
  it('adds shipping on a Proposal only', () => {
    const lines = [L({ quantity: 2 })];
    expect(totals(C(lines, { type: 'Proposal', shipping: 62 }))).toEqual({ items: 340, shipping: 62, total: 402 });
    expect(totals(C(lines, { type: 'WA', shipping: 62 })).total).toBe(340);
  });
  it('lists units by building then unit number', () => {
    const u = unitRows([L({ building: '2', unit: '10' }), L({ building: '1', unit: '9' }), L({ building: '1', unit: '10' })]);
    expect(u.map((x) => `${x.building}-${x.unit}`)).toEqual(['1-9', '1-10', '2-10']);
  });
  it('places clauses by key and honours the audience', () => {
    const s = bySlot(C([L()], { clauses: [{ key: 'wa_intro', title: 'a', body: 'x' }, { key: 'quote_notice', title: 'b', body: 'y', audience: 'client' }, { key: 'custom', title: 'c', body: 'z' }] }), 'tech');
    expect(s.intro).toHaveLength(1); expect(s.terms).toHaveLength(0); expect(s.extra).toHaveLength(1);
  });
  it('takes the invoicing code from the number', () => expect(invoicingCode('262000000-261110-2')).toBe('262000000'));
  it('technician HTML and PDF show no prices', async () => {
    const c = C([L()], { chargeCode: '23' });
    const html = renderDocumentHtml(c, 'tech');
    expect(html).not.toContain('$85'); expect(html).not.toContain('Estimated total'); expect(html).not.toContain('charge code');
    expect(renderDocumentHtml(c, 'client')).toContain('$170.00');
    const pdf = await renderPdf(C(Array.from({ length: 80 }, (_, i) => L({ unit: String(100 + i) }))), 'tech');
    expect(Buffer.from(pdf).toString('latin1').startsWith('%PDF-')).toBe(true);
  });
});
