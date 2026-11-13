// Service Notes close-out: one record per visit that turns a technician's report into client notes, an internal
// invoicing sheet, and (part B) the billing ID update. Reads existing visit/event/part history; adds only wording, photos and approval.
import type { Db } from '../db';
import { LIVE_EVENT, type Result } from './record';
import { defaultResult, issueLabel, suggestComment } from './phrases';
import { invoicingFor, laborRate, CHARGE_CODES, WORK_LABEL, type ChargeCode } from '../documents/build';
import { getPropertyPrices } from '../documents/systemnotes';
import { groupWork, type WorkGroup } from '../documents/layout';
import type { FrozenLine } from '../documents/render';

export class CloseoutError extends Error {}
type Q = Pick<Db, 'query'>;

export interface CloseoutUnit {
  eventId: string; endpointId: string;
  building: string; unit: string; address: string | null; service: string;
  issueCode: string | null; issue: string; result: Result; resultLabel?: string;
  startRead: number | null; endRead: number | null; newTxId: string | null; equipment: string;
  techNotes: string | null; suggested: string; clientComment: string | null; extraComment: string | null;
  action: string; laborCovered: boolean; partCovered: boolean;
}
export interface Closeout {
  visit: { id: string; visitedOn: string; technician: string | null; outcome: string; status: 'draft' | 'approved'; approvedAt: string | null; summary: string | null;
    salesforceCase: string | null; salesforceWorkOrder: string | null; documentNumber: string | null; notes: string | null };
  property: { id: string; name: string; classId: string; address: string | null; city: string | null; state: string | null; zip: string | null };
  contact: { name: string | null; phone: string | null; email: string | null };
  code: string; chargeCode: ChargeCode;
  units: CloseoutUnit[];
  counts: { NI: number; NT: number; INT: number; HIGHLOW: number; other: number; total: number };
  photos: { id: string; endpointId: string | null; filename: string; caption: string | null; includeInClient: boolean }[];
}

export function countIssues(units: { issueCode: string | null }[]) {
  const c = { NI: 0, NT: 0, INT: 0, HIGHLOW: 0, other: 0, total: units.length };
  for (const u of units) {
    const k = (u.issueCode ?? '').toUpperCase();
    if (k === 'NI') c.NI++; else if (k === 'NT') c.NT++; else if (k === 'INT') c.INT++; else if (['HIGH', 'LOW', 'NEG'].includes(k)) c.HIGHLOW++; else c.other++;
  }
  return c;
}

const num = (v: string | null) => (v === null ? null : Number(v));

export async function closeoutData(db: Q, visitId: string): Promise<Closeout> {
  const v = (await db.query<{ id: string; property_id: string; visited_on: string; technician: string | null; outcome: string; notes_status: 'draft' | 'approved'; approved_at: string | null;
    client_summary: string | null; salesforce_case: string | null; salesforce_work_order: string | null; notes: string | null; doc_number: string | null }>(
    `SELECT v.id, v.property_id, v.visited_on::text, v.technician, v.outcome, v.notes_status, v.approved_at::text, v.client_summary, v.salesforce_case, v.salesforce_work_order, v.notes,
            (SELECT d.number FROM document d WHERE d.id=v.document_id) doc_number
       FROM visit v WHERE v.id=$1`, [visitId])).rows[0];
  if (!v) throw new CloseoutError('Unknown visit.');
  const p = (await db.query<{ id: string; name: string; class_id: string; address: string | null; city: string | null; state: string | null; zip: string | null }>(
    `SELECT id, name, class_id, address, city, state, zip FROM property WHERE id=$1`, [v.property_id])).rows[0];
  const c = (await db.query<{ name: string; phone: string | null; email: string | null }>(
    `SELECT name, phone, email FROM contact WHERE property_id=$1 ORDER BY is_primary DESC, name LIMIT 1`, [v.property_id])).rows[0];
  const inv = await invoicingFor(db, v.property_id, v.visited_on);

  const ev = await db.query<{ id: string; endpoint_id: string; building: string; unit: string; address: string | null; service_code: string; action: string; issue_code: string | null;
    result: Result | null; read_at_service: string | null; end_read: string | null; notes: string | null; labor_covered: boolean; part_covered: boolean;
    client_comment: string | null; extra_comment: string | null }>(
    `SELECT se.id, se.endpoint_id, b.label building, u.current_label unit, u.service_address address, e.service_code, se.action, se.issue_code, se.result,
            se.read_at_service::text, se.end_read::text, se.notes, se.labor_covered, se.part_covered, n.client_comment, n.extra_comment
       FROM service_event se JOIN endpoint e ON e.id=se.endpoint_id JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id
       LEFT JOIN event_note n ON n.service_event_id=se.id
      WHERE se.visit_id=$1 AND ${LIVE_EVENT}
      ORDER BY b.label, u.current_label, e.service_code`, [visitId]);
  const parts = await db.query<{ service_event_id: string; kind: string; model: string | null; hardware_id: string | null; quantity: string; name: string | null }>(
    `SELECT ep.service_event_id, d.kind, d.model, d.hardware_id, ep.quantity::text, c.name
       FROM event_part ep JOIN device d ON d.id=ep.new_device_id LEFT JOIN catalog_item c ON c.id=ep.catalog_item_id
      WHERE ep.service_event_id = ANY($1::uuid[])`, [ev.rows.map((x) => x.id)]);

  const units: CloseoutUnit[] = ev.rows.map((e) => {
    const ps = parts.rows.filter((x) => x.service_event_id === e.id);
    const result = e.result ?? defaultResult(e.action as never, v.outcome);
    const tx = ps.find((x) => x.kind !== 'meter' && x.hardware_id)?.hardware_id ?? null;
    return {
      eventId: e.id, endpointId: e.endpoint_id, building: e.building, unit: e.unit, address: e.address, service: e.service_code,
      issueCode: e.issue_code, issue: issueLabel(e.issue_code), result,
      startRead: num(e.read_at_service), endRead: num(e.end_read), newTxId: tx,
      equipment: ps.map((x) => `${Number(x.quantity) === 1 ? '' : `${x.quantity} x `}${x.name ?? x.model ?? x.kind}`).join('; '),
      techNotes: e.notes, action: e.action, laborCovered: e.labor_covered, partCovered: e.part_covered,
      suggested: suggestComment({ issueCode: e.issue_code, result, newTxId: tx, replacedKinds: ps.map((x) => x.kind), startRead: num(e.read_at_service), endRead: num(e.end_read) }),
      clientComment: e.client_comment, extraComment: e.extra_comment,
    };
  });
  const photos = (await db.query<{ id: string; endpoint_id: string | null; filename: string; caption: string | null; include_in_client: boolean }>(
    `SELECT id, endpoint_id, filename, caption, include_in_client FROM visit_photo WHERE visit_id=$1 ORDER BY created_at`, [visitId])).rows
    .map((x) => ({ id: x.id, endpointId: x.endpoint_id, filename: x.filename, caption: x.caption, includeInClient: x.include_in_client }));
  return {
    visit: { id: v.id, visitedOn: v.visited_on, technician: v.technician, outcome: v.outcome, status: v.notes_status, approvedAt: v.approved_at, summary: v.client_summary,
      salesforceCase: v.salesforce_case, salesforceWorkOrder: v.salesforce_work_order, documentNumber: v.doc_number, notes: v.notes },
    property: { id: p.id, name: p.name, classId: p.class_id, address: p.address, city: p.city, state: p.state, zip: p.zip },
    contact: { name: c?.name ?? null, phone: c?.phone ?? null, email: c?.email ?? null },
    code: inv.code, chargeCode: inv.chargeCode, units, counts: countIssues(units), photos,
  };
}

/** What the client will read for a unit: the coordinator's wording, else the drafted text. */
export const clientText = (u: Pick<CloseoutUnit, 'clientComment' | 'suggested'>) => (u.clientComment?.trim() ? u.clientComment.trim() : u.suggested);

/** Save wording for the client. Editing approved notes puts the visit back to draft so they are reviewed again. */
export async function saveClientText(db: Db, visitId: string, edits: { eventId: string; clientComment: string | null; extraComment: string | null }[], summary: string | null, userId: string | null) {
  await db.transaction(async (tx) => {
    for (const e of edits) {
      const own = await tx.query(`SELECT 1 FROM service_event WHERE id=$1 AND visit_id=$2`, [e.eventId, visitId]);
      if (!own.rows.length) throw new CloseoutError('An event does not belong to this visit.');
      await tx.query(
        `INSERT INTO event_note (service_event_id,client_comment,extra_comment,updated_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (service_event_id) DO UPDATE SET client_comment=$2, extra_comment=$3, updated_by=$4, updated_at=now()`,
        [e.eventId, e.clientComment?.trim() || null, e.extraComment?.trim() || null, userId]);
    }
    await tx.query(`UPDATE visit SET client_summary=$2, notes_status='draft', approved_by=NULL, approved_at=NULL WHERE id=$1`, [visitId, summary?.trim() || null]);
  });
}

/** Approve the client notes. Every unit needs wording (a coordinator's or the drafted text), and completed visits need a technician. */
export async function approveCloseout(db: Db, visitId: string, userId: string | null) {
  const c = await closeoutData(db, visitId);
  if (!c.units.length) throw new CloseoutError('Nothing to approve: the visit has no units.');
  if (!c.visit.technician) throw new CloseoutError('Enter the technician before approving.');
  const blank = c.units.filter((u) => !clientText(u).trim());
  if (blank.length) throw new CloseoutError(`${blank.length} unit${blank.length === 1 ? ' has' : 's have'} no client wording: ${blank.slice(0, 5).map((u) => `${u.building}-${u.unit}`).join(', ')}.`);
  await db.query(`UPDATE visit SET notes_status='approved', approved_by=$2, approved_at=now() WHERE id=$1`, [visitId, userId]);
  await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'closeout_approved','visit',$2,'{}')`, [userId, visitId]);
}

export async function addPhoto(db: Db, visitId: string, p: { endpointId?: string | null; filename: string; mime: string; bytes: Uint8Array; caption?: string | null; includeInClient?: boolean }) {
  if (!/^image\/(jpeg|png)$/.test(p.mime)) throw new CloseoutError('Photos must be JPEG or PNG.');
  if (p.bytes.length > 8 * 1024 * 1024) throw new CloseoutError('A photo can be at most 8 MB.');
  await db.query(`INSERT INTO visit_photo (visit_id,endpoint_id,filename,mime,bytes,caption,include_in_client) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [visitId, p.endpointId ?? null, p.filename.replace(/[^\w.\- ]+/g, '_'), p.mime, p.bytes, p.caption?.trim() || null, p.includeInClient ?? false]);
  await db.query(`UPDATE visit SET notes_status='draft', approved_by=NULL, approved_at=NULL WHERE id=$1 AND notes_status='approved'`, [visitId]);
}

// ---------- internal invoicing sheet ----------
export interface InvoiceSheet {
  closeout: Closeout;
  workAuthorization: string | null;
  chargeLabel: string;
  groups: WorkGroup[];
  total: number;
  warnings: string[];
  /** Per event, for recording the submission. */
  items: { eventId: string; laborAmount: number; partAmounts: Record<string, number> }[];
}

const PROPERTY_PRICE_ITEM: Record<string, string> = { transmitter: 'Transmitter', meter: 'Meter', combo: 'Transmitter' };

export async function invoiceSheet(db: Db, visitId: string): Promise<InvoiceSheet> {
  const c = await closeoutData(db, visitId);
  const warnings: string[] = [];
  if (c.visit.outcome !== 'completed') warnings.push('This visit was not completed, so there is nothing to invoice.');
  const prices = await getPropertyPrices(db, c.property.id);
  const labor = prices['Labor'] ?? (await laborRate(db));
  const parts = await db.query<{ id: string; service_event_id: string; kind: string; quantity: string; price: string | null; name: string | null }>(
    `SELECT ep.id, ep.service_event_id, d.kind, ep.quantity::text, ci.price::text, ci.name
       FROM event_part ep JOIN device d ON d.id=ep.new_device_id LEFT JOIN catalog_item ci ON ci.id=ep.catalog_item_id
      WHERE ep.service_event_id = ANY($1::uuid[])`, [c.units.map((u) => u.eventId)]);
  const lines: FrozenLine[] = []; const items: InvoiceSheet['items'] = [];
  for (const u of c.units) {
    const ps = parts.rows.filter((x) => x.service_event_id === u.eventId);
    const partAmounts: Record<string, number> = {};
    let partTotal = 0; let missing = false;
    for (const p of ps) {
      const unitPrice = prices[PROPERTY_PRICE_ITEM[p.kind]] ?? (p.price === null ? null : Number(p.price));
      if (unitPrice === null) { missing = true; partAmounts[p.id] = 0; continue; }
      partAmounts[p.id] = Math.round(unitPrice * Number(p.quantity) * 100) / 100; partTotal += partAmounts[p.id];
    }
    if (missing) warnings.push(`${u.building}-${u.unit}: a part has no price in the catalog or for this property.`);
    const eq = [...new Set(ps.map((p) => p.name ?? p.kind))].join(', ');
    const base = u.issueCode && WORK_LABEL[u.issueCode.toUpperCase()] ? WORK_LABEL[u.issueCode.toUpperCase()] : `Meter Service - ${u.issue}`;
    lines.push({ building: u.building, unit: u.unit, address: u.address, service: u.service, issueCode: u.issueCode, description: eq ? `${base} (${eq})` : base, component: null,
      quantity: 1, unitPrice: ps.length ? partTotal : null, laborPrice: labor, laborCovered: u.laborCovered, partCovered: u.partCovered, include: c.visit.outcome === 'completed' });
    items.push({ eventId: u.eventId, laborAmount: labor, partAmounts });
  }
  const groups = groupWork(lines);
  return { closeout: c, workAuthorization: c.visit.documentNumber, chargeLabel: CHARGE_CODES[c.chargeCode], groups,
    total: Math.round(groups.reduce((s, g) => s + g.total, 0) * 100) / 100, warnings, items };
}

/** Record that this sheet went to admin. Uses the sheet's amounts; the existing rules still zero warranty-covered work and prevent double invoicing. */
export async function sendInvoiceSheet(db: Db, visitId: string, userId: string | null, submittedOn: string, externalRef: string | null) {
  const s = await invoiceSheet(db, visitId);
  if (s.closeout.visit.status !== 'approved') throw new CloseoutError('Approve the client notes before sending the invoicing sheet.');
  const { submitInvoice } = await import('../billing/invoice');
  return submitInvoice(db, { propertyId: s.closeout.property.id, submittedOn, submittedBy: userId, externalRef, items: s.items.map((i) => ({ eventId: i.eventId, laborAmount: i.laborAmount, partAmounts: i.partAmounts })) });
}
