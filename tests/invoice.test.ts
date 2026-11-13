import { describe, it, expect } from 'vitest';
import { world, count } from './helpers';
import { recordVisit, correctEvent } from '../src/service/record';
import { uninvoicedEvents, submitInvoice, InvoiceError } from '../src/billing/invoice';

const U1 = '00000000-0000-0000-0000-000000000001';

describe('invoicing', () => {
  it('lists completed, standing, uninvoiced events with their parts', async () => {
    const { db, pid, ep } = await world();
    await db.query(`INSERT INTO catalog_item (name,kind,component,price) VALUES ('Transmitter','part','transmitter',85)`);
    const cat = (await db.query<{ id: string }>(`SELECT id FROM catalog_item`)).rows[0].id;
    await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed', salesforceCase: '00099',
      events: [{ endpointId: await ep('102'), action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'N1', catalogItemId: cat }] }] });
    await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-02', outcome: 'unable_to_access', events: [{ endpointId: await ep('104'), action: 'other' }] });
    const open = await uninvoicedEvents(db, pid);
    expect(open).toHaveLength(1);                                         // the unable-to-access visit is not billable work
    expect(open[0]).toMatchObject({ unit: '102', action: 'replace', salesforceCase: '00099' });
    expect(open[0].parts[0]).toMatchObject({ kind: 'transmitter', catalogName: 'Transmitter', catalogPrice: 85 });
  });

  it('records amounts, and an event or part can be invoiced only once', async () => {
    const { db, pid, ep } = await world();
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed',
      events: [{ endpointId: await ep('102'), action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'N1' }] }] });
    const [open] = await uninvoicedEvents(db, pid);
    const s = await submitInvoice(db, { propertyId: pid, submittedOn: '2026-08-05', submittedBy: U1, externalRef: 'INV-77',
      items: [{ eventId: v.eventIds[0], laborAmount: 125, partAmounts: { [open.parts[0].partId]: 85 } }] });
    expect(s).toMatchObject({ lines: 2, billable: 2, notBillable: 0, total: 210 });
    expect(await uninvoicedEvents(db, pid)).toHaveLength(0);
    await expect(submitInvoice(db, { propertyId: pid, submittedOn: '2026-08-06', items: [{ eventId: v.eventIds[0] }] })).rejects.toThrow(InvoiceError);
    expect(await count(db, `SELECT count(*)::text n FROM invoice_submission`)).toBe(1);
  });

  it('warranty-covered work is recorded non-billable at $0, unless overridden with a reason', async () => {
    const { db, pid, ep } = await world({ installedByUs: true });
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-06', outcome: 'completed',
      events: [{ endpointId: await ep('101'), action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'N1' }] }] });
    const [open] = await uninvoicedEvents(db, pid);
    expect(open).toMatchObject({ laborCovered: true, partCovered: true });
    const s = await submitInvoice(db, { propertyId: pid, submittedOn: '2026-11-07', items: [{ eventId: v.eventIds[0], laborAmount: 125, partAmounts: { [open.parts[0].partId]: 85 } }] });
    expect(s).toMatchObject({ lines: 2, billable: 0, notBillable: 2, total: 0 });
    const lines = await db.query<{ amount: string; billable: boolean }>(`SELECT amount::text, billable FROM invoice_line`);
    expect(lines.rows.every((l) => !l.billable && l.amount === '0.00')).toBe(true);
  });

  it('billing covered work needs a reason, then keeps it on the line', async () => {
    const { db, pid, ep } = await world({ installedByUs: true });
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-06', outcome: 'completed', events: [{ endpointId: await ep('101'), action: 'repair', issueCode: 'NT' }] });
    await expect(submitInvoice(db, { propertyId: pid, submittedOn: '2026-11-07', items: [{ eventId: v.eventIds[0], laborAmount: 125, overrideCovered: true }] })).rejects.toThrow(/reason/);
    const s = await submitInvoice(db, { propertyId: pid, submittedOn: '2026-11-07', items: [{ eventId: v.eventIds[0], laborAmount: 125, overrideCovered: true, overrideReason: 'Tenant damage, not workmanship' }] });
    expect(s).toMatchObject({ billable: 1, total: 125 });
    expect((await db.query<{ override_reason: string }>(`SELECT override_reason FROM invoice_line`)).rows[0].override_reason).toContain('Tenant damage');
  });

  it('a corrected event is invoiced as its latest version, and an invoiced event cannot be corrected', async () => {
    const { db, pid, ep } = await world();
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed', events: [{ endpointId: await ep('102'), action: 'repair', notes: 'wrong' }] });
    const next = await correctEvent(db, v.eventIds[0], { notes: 'right' });
    const open = await uninvoicedEvents(db, pid);
    expect(open.map((o) => o.eventId)).toEqual([next]);                   // the original is never offered
    await submitInvoice(db, { propertyId: pid, submittedOn: '2026-08-05', items: [{ eventId: next, laborAmount: 100 }] });
    await expect(correctEvent(db, next, { notes: 'too late' })).rejects.toThrow(/invoiced/);
  });

  it('rejects an empty selection and events from another property', async () => {
    const { db, pid, ep } = await world();
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed', events: [{ endpointId: await ep('102'), action: 'repair' }] });
    const other = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ('7','Other') RETURNING id`)).rows[0].id;
    await expect(submitInvoice(db, { propertyId: pid, submittedOn: '2026-08-05', items: [] })).rejects.toThrow(/Nothing selected/);
    await expect(submitInvoice(db, { propertyId: other, submittedOn: '2026-08-05', items: [{ eventId: v.eventIds[0] }] })).rejects.toThrow(InvoiceError);
  });
});
