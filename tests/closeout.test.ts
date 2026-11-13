import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { recordVisit } from '../src/service/record';
import { closeoutData, saveClientText, approveCloseout, addPhoto, invoiceSheet, sendInvoiceSheet, clientText } from '../src/service/closeout';
import { suggestComment, defaultResult } from '../src/service/phrases';
import { autoAuditGrid, CLASS_ID } from './fixtures';

async function setup() {
  const db = await openDb();
  const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name,address,city,state,zip) VALUES ($1,'Test Property','1 Test Rd','Austin','TX','78701') RETURNING id`, [CLASS_ID])).rows[0].id;
  await db.query(`INSERT INTO contact (property_id,name,phone,email,is_primary) VALUES ($1,'Pat Manager','555-0100','pat@example.test',true)`, [pid]);
  await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
  const eps = (await db.query<{ id: string; unit: string }>(`SELECT e.id, u.current_label unit FROM endpoint e JOIN unit u ON u.id=e.unit_id ORDER BY u.current_label`)).rows;
  return { db, pid, ep: (u: string) => eps.find((e) => e.unit.trim() === u)!.id };
}

describe('phrases', () => {
  it('drafts plain wording from fixed templates', () => {
    const t = suggestComment({ issueCode: 'NT', result: 'replaced', newTxId: 'TX1', replacedKinds: ['transmitter'], startRead: 10, endRead: 11 });
    expect(t).toContain('not sending readings'); expect(t).toContain('new transmitter ID TX1'); expect(t).toContain('read 10 before and 11 after');
    expect(suggestComment({ issueCode: 'NI', result: 'no_fault_found' })).toContain('found no fault');
    expect(suggestComment({ issueCode: null, result: 'other' })).toBe('');
  });
  it('maps action and outcome to a default result', () => {
    expect(defaultResult('replace', 'completed')).toBe('replaced');
    expect(defaultResult('replace', 'unable_to_access')).toBe('unable_to_access');
  });
});

describe('close-out', () => {
  it('builds notes, counts issues, and requires approval before invoicing is sent', async () => {
    const { db, pid, ep } = await setup();
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-10', technician: 'T. Tech', outcome: 'completed', events: [
      { endpointId: ep('000102'), action: 'replace', issueCode: 'NT', readAtService: 100, endRead: 101, notes: 'tight space', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX1' }] },
      { endpointId: ep('000103'), action: 'inspect_test', issueCode: 'NI', notes: 'meter ok' },
    ] });
    const c = await closeoutData(db, r.visitId);
    expect(c.units).toHaveLength(2);
    expect(c.counts).toMatchObject({ NT: 1, NI: 1, total: 2 });
    expect(c.contact.name).toBe('Pat Manager');
    const nt = c.units.find((u) => u.issueCode === 'NT')!;
    expect(nt).toMatchObject({ result: 'replaced', newTxId: 'NEWTX1', startRead: 100, endRead: 101 });
    expect(clientText(nt)).toContain('NEWTX1');

    await expect(sendInvoiceSheet(db, r.visitId, null, '2026-11-11', null)).rejects.toThrow(/Approve/);
    await saveClientText(db, r.visitId, [{ eventId: nt.eventId, clientComment: 'Replaced the transmitter.', extraComment: null }], 'Work completed.', null);
    await approveCloseout(db, r.visitId, null);
    const again = await closeoutData(db, r.visitId);
    expect(again.visit.status).toBe('approved');
    expect(clientText(again.units.find((u) => u.issueCode === 'NT')!)).toBe('Replaced the transmitter.');
    await saveClientText(db, r.visitId, [], 'Edited.', null);
    expect((await closeoutData(db, r.visitId)).visit.status).toBe('draft');   // editing sends it back for review
  });

  it('prices the invoicing sheet: labor default, warranty zeroed, grouped, sent once', async () => {
    const { db, pid, ep } = await setup();
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-10', technician: 'T', outcome: 'completed', events: [
      { endpointId: ep('000102'), action: 'inspect_test', issueCode: 'NT' }, { endpointId: ep('000104'), action: 'inspect_test', issueCode: 'NT' } ] });
    const s = await invoiceSheet(db, r.visitId);
    expect(s.groups).toHaveLength(1);                         // identical work grouped
    expect(s.groups[0].quantity).toBe(2);
    expect(s.total).toBe(170);                                // 2 x $85 labor
    await approveCloseout(db, r.visitId, null);
    const sub = await sendInvoiceSheet(db, r.visitId, null, '2026-11-11', 'REF1');
    expect(sub.total).toBe(170);
    await expect(sendInvoiceSheet(db, r.visitId, null, '2026-11-11', null)).rejects.toThrow();   // already invoiced
  });

  it('accepts only JPEG or PNG photos and reopens approval', async () => {
    const { db, pid, ep } = await setup();
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-10', technician: 'T', outcome: 'completed', events: [{ endpointId: ep('000102'), action: 'inspect_test', issueCode: 'NT' }] });
    await approveCloseout(db, r.visitId, null);
    await expect(addPhoto(db, r.visitId, { filename: 'x.gif', mime: 'image/gif', bytes: new Uint8Array(3) })).rejects.toThrow(/JPEG/);
    await addPhoto(db, r.visitId, { filename: 'a b.jpg', mime: 'image/jpeg', bytes: new Uint8Array(3), includeInClient: true });
    const c = await closeoutData(db, r.visitId);
    expect(c.photos).toHaveLength(1); expect(c.visit.status).toBe('draft');
  });
});

import { renderNotesPdf, renderInvoicePdf } from '../src/service/pdf';
describe('close-out PDFs', () => {
  it('renders client notes and the internal invoicing sheet', async () => {
    const { db, pid, ep } = await setup();
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-10', technician: 'T. Tech', outcome: 'completed', events: [
      { endpointId: ep('000102'), action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX1' }] }] });
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const notes = await renderNotesPdf(await closeoutData(db, r.visitId), [{ caption: 'Before', where: '1-102', mime: 'image/png', bytes: png }]);
    expect(Buffer.from(notes).subarray(0, 4).toString()).toBe('%PDF');
    const inv = await renderInvoicePdf(await invoiceSheet(db, r.visitId));
    expect(Buffer.from(inv).subarray(0, 4).toString()).toBe('%PDF');
    const S = process.env.PDF_OUT; if (S) { (await import('node:fs')).writeFileSync(`${S}/notes.pdf`, notes); (await import('node:fs')).writeFileSync(`${S}/invoice.pdf`, inv); }
  });
});
