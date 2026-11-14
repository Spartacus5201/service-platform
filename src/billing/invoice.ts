// Invoicing: what was done, what is covered, what has gone to admin, and when.
import { UserError } from '../errors';
import type { Db } from '../db';
import { LIVE_EVENT } from '../service/record';

export class InvoiceError extends UserError {}

export interface UninvoicedEvent {
  eventId: string;
  visitedOn: string;
  building: string; unit: string; service: string;
  action: string; issueCode: string | null;
  laborCovered: boolean; partCovered: boolean;
  parts: { partId: string; kind: string; model: string | null; quantity: number; catalogName: string | null; catalogPrice: number | null }[];
  salesforceCase: string | null; salesforceWorkOrder: string | null;
}

/** Completed service events that have not been sent for invoicing yet. Superseded events never appear. */
export async function uninvoicedEvents(db: Db, propertyId: string): Promise<UninvoicedEvent[]> {
  const ev = await db.query<{ id: string; visited_on: string; building: string; unit: string; service_code: string; action: string; issue_code: string | null;
    labor_covered: boolean; part_covered: boolean; salesforce_case: string | null; salesforce_work_order: string | null }>(
    `SELECT se.id, v.visited_on::text, b.label building, u.current_label unit, e.service_code, se.action, se.issue_code, se.labor_covered, se.part_covered,
            v.salesforce_case, v.salesforce_work_order
       FROM service_event se JOIN visit v ON v.id=se.visit_id JOIN endpoint e ON e.id=se.endpoint_id JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id
      WHERE v.property_id=$1 AND v.outcome='completed' AND ${LIVE_EVENT}
        AND NOT EXISTS (SELECT 1 FROM invoice_line il WHERE il.service_event_id = se.id)
      ORDER BY v.visited_on, b.label, u.current_label`, [propertyId]);
  const parts = await db.query<{ id: string; service_event_id: string; kind: string; model: string | null; quantity: string; name: string | null; price: string | null }>(
    `SELECT ep.id, ep.service_event_id, d.kind, d.model, ep.quantity::text, c.name, c.price::text
       FROM event_part ep JOIN device d ON d.id=ep.new_device_id LEFT JOIN catalog_item c ON c.id=ep.catalog_item_id
      WHERE ep.service_event_id = ANY($1::uuid[])
        AND NOT EXISTS (SELECT 1 FROM invoice_line il WHERE il.event_part_id = ep.id)`, [ev.rows.map((x) => x.id)]);
  return ev.rows.map((x) => ({
    eventId: x.id, visitedOn: x.visited_on, building: x.building, unit: x.unit, service: x.service_code, action: x.action, issueCode: x.issue_code,
    laborCovered: x.labor_covered, partCovered: x.part_covered, salesforceCase: x.salesforce_case, salesforceWorkOrder: x.salesforce_work_order,
    parts: parts.rows.filter((p) => p.service_event_id === x.id).map((p) => ({ partId: p.id, kind: p.kind, model: p.model, quantity: Number(p.quantity), catalogName: p.name, catalogPrice: p.price === null ? null : Number(p.price) })),
  }));
}

export interface InvoiceItem {
  eventId: string;
  /** Labor / service charge for the event. Defaults to 0. */
  laborAmount?: number;
  /** Amount per part row, keyed by event_part id. Missing parts are sent at 0. */
  partAmounts?: Record<string, number>;
  /** Bill something warranty covers. Requires a reason. */
  overrideCovered?: boolean;
  overrideReason?: string;
  description?: string;
}

export interface Submission { submissionId: string; lines: number; billable: number; notBillable: number; total: number }

/**
 * Record an invoicing report sent to admin. An event or part can be sent once; warranty-covered work is recorded as
 * non-billable unless someone overrides with a reason.
 */
export async function submitInvoice(db: Db, a: {
  propertyId: string; documentId?: string | null; submittedOn: string; submittedBy?: string | null; externalRef?: string | null; items: InvoiceItem[];
}): Promise<Submission> {
  if (!a.items.length) throw new InvoiceError('Nothing selected to invoice.');
  const open = new Map((await uninvoicedEvents(db, a.propertyId)).map((e) => [e.eventId, e]));
  for (const it of a.items) {
    if (!open.has(it.eventId)) throw new InvoiceError('An event is unknown, from another property, not completed, corrected, or already invoiced.');
    if (it.overrideCovered && !it.overrideReason?.trim()) throw new InvoiceError('Billing warranty-covered work needs a reason.');
  }
  const out: Submission = { submissionId: '', lines: 0, billable: 0, notBillable: 0, total: 0 };
  await db.transaction(async (tx) => {
    out.submissionId = (await tx.query<{ id: string }>(
      `INSERT INTO invoice_submission (property_id,document_id,submitted_on,submitted_by,external_ref) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [a.propertyId, a.documentId ?? null, a.submittedOn, a.submittedBy ?? null, a.externalRef ?? null])).rows[0].id;
    const add = async (eventId: string | null, partId: string | null, desc: string, amount: number, billable: boolean, reason: string | null) => {
      await tx.query(`INSERT INTO invoice_line (submission_id,service_event_id,event_part_id,description,quantity,amount,billable,override_reason) VALUES ($1,$2,$3,$4,1,$5,$6,$7)`,
        [out.submissionId, eventId, partId, desc, billable ? amount : 0, billable, reason]);
      out.lines++; if (billable) { out.billable++; out.total += amount; } else out.notBillable++;
    };
    for (const it of a.items) {
      const e = open.get(it.eventId)!;
      const label = it.description ?? `${e.building}-${e.unit} ${e.action.replace('_', '/')}${e.issueCode ? ` (${e.issueCode})` : ''} ${e.visitedOn}`;
      const laborBillable = !e.laborCovered || !!it.overrideCovered;
      await add(e.eventId, null, `${label}: labor`, it.laborAmount ?? 0, laborBillable, laborBillable && e.laborCovered ? it.overrideReason! : null);
      for (const p of e.parts) {
        const partBillable = !e.partCovered || !!it.overrideCovered;
        await add(null, p.partId, `${label}: ${p.catalogName ?? p.kind}${p.model ? ` ${p.model}` : ''}`, it.partAmounts?.[p.partId] ?? 0, partBillable, partBillable && e.partCovered ? it.overrideReason! : null);
      }
    }
  });
  out.total = Math.round(out.total * 100) / 100;
  return out;
}
