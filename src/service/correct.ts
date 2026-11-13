// Fixing recorded service. Nothing is deleted: events are superseded or voided, visit and device fields are changed
// with a reason, and every change is written to the audit log and shown on the visit.
import type { Db } from '../db';
import { coverage } from '../rules/warranty';
import { loadSettings } from '../queries/audit';
import { correctEvent, LIVE_EVENT, ServiceError, type EventPatch, type Outcome } from './record';

type Q = Pick<Db, 'query'>;
const one = async <T>(q: Q, sql: string, p: unknown[] = []) => (await q.query<T>(sql, p)).rows[0] as T | undefined;
const need = (reason: string | null | undefined) => { const r = (reason ?? '').trim(); if (!r) throw new ServiceError('Say why the change is needed.'); return r; };
const log = (q: Q, userId: string | null, action: string, entity: string, id: string, detail: unknown) =>
  q.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,$2,$3,$4,$5)`, [userId, action, entity, id, JSON.stringify(detail)]);
const reopenNotes = (q: Q, visitId: string) => q.query(`UPDATE visit SET notes_status='draft', approved_by=NULL, approved_at=NULL WHERE id=$1`, [visitId]);

const isInvoiced = async (q: Q, eventId: string) => !!(await one(q, `SELECT 1 FROM invoice_line WHERE service_event_id=$1`, [eventId]));

/** Correct a non-replace event, with a reason. Returns the new event id. */
export async function correctEventWithReason(db: Db, eventId: string, patch: EventPatch, reason: string, userId: string | null): Promise<string> {
  const r = need(reason);
  const next = await correctEvent(db, eventId, patch, userId, r);
  const v = await one<{ visit_id: string }>(db, `SELECT visit_id FROM service_event WHERE id=$1`, [next]);
  await reopenNotes(db, v!.visit_id);
  return next;
}

/** Remove an event that should never have been recorded. A replace event is reversed: the old device is back in service. */
export async function voidEvent(db: Db, eventId: string, reason: string, userId: string | null): Promise<void> {
  const r = need(reason);
  const ev = await one<{ id: string; visit_id: string; endpoint_id: string; live: boolean; visited_on: string }>(db,
    `SELECT se.id, se.visit_id, se.endpoint_id, ${LIVE_EVENT} AS live, v.visited_on::text FROM service_event se JOIN visit v ON v.id=se.visit_id WHERE se.id=$1`, [eventId]);
  if (!ev) throw new ServiceError('Unknown event.');
  if (!ev.live) throw new ServiceError('That event was already corrected or voided.');
  if (await isInvoiced(db, eventId)) throw new ServiceError('This event has been invoiced and can no longer be voided.');
  await db.transaction(async (tx) => {
    const parts = (await tx.query<{ old_device_id: string | null; new_device_id: string }>(`SELECT old_device_id, new_device_id FROM event_part WHERE service_event_id=$1`, [eventId])).rows;
    for (const p of parts) {
      const gone = await one(tx, `SELECT 1 FROM installation WHERE device_id=$1 AND removed_on IS NOT NULL`, [p.new_device_id]);
      if (gone) throw new ServiceError('The part installed by this event has since been replaced, so the event cannot be voided. Record a correcting visit instead.');
    }
    for (const p of parts) {
      await tx.query(`UPDATE installation SET removed_on=$2 WHERE device_id=$1 AND removed_on IS NULL`, [p.new_device_id, ev.visited_on]);
      await tx.query(`UPDATE device SET status='removed' WHERE id=$1`, [p.new_device_id]);
      if (p.old_device_id) {
        await tx.query(`UPDATE installation SET removed_on=NULL WHERE device_id=$1 AND endpoint_id=$2 AND removed_on=$3`, [p.old_device_id, ev.endpoint_id, ev.visited_on]);
        await tx.query(`UPDATE device SET status='active' WHERE id=$1`, [p.old_device_id]);
      }
    }
    await tx.query(`UPDATE service_event SET voided=true, void_reason=$2 WHERE id=$1`, [eventId, r]);
    await reopenNotes(tx, ev.visit_id);
    await log(tx, userId, 'event_voided', 'service_event', eventId, { visit_id: ev.visit_id, reason: r });
  });
}

/** Fix the ID of a part a replace event installed (the usual typo). Allowed after invoicing: billing does not depend on it. */
export async function correctPartId(db: Db, eventId: string, newHardwareId: string, reason: string, userId: string | null, kind?: string): Promise<void> {
  const r = need(reason);
  const id = newHardwareId.trim();
  if (!id) throw new ServiceError('Enter the corrected ID.');
  const part = await one<{ device_id: string; hardware_id: string | null; property_id: string; kind: string; visit_id: string }>(db,
    `SELECT d.id device_id, d.hardware_id, d.property_id, d.kind, se.visit_id
       FROM event_part ep JOIN device d ON d.id=ep.new_device_id JOIN service_event se ON se.id=ep.service_event_id
      WHERE ep.service_event_id=$1 AND ($2::text IS NULL OR d.kind=$2) AND d.kind <> 'meter' ORDER BY d.kind LIMIT 1`, [eventId, kind ?? null]);
  if (!part) throw new ServiceError('That event did not install a part with a radio ID.');
  if (part.hardware_id === id) return;
  const dup = await one(db, `SELECT 1 FROM device WHERE property_id=$1 AND kind=$2 AND hardware_id=$3 AND status='active' AND id<>$4`, [part.property_id, part.kind, id, part.device_id]);
  if (dup) throw new ServiceError(`A ${part.kind} with ID ${id} is already active at this property.`);
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE device SET hardware_id=$2 WHERE id=$1`, [part.device_id, id]);
    await reopenNotes(tx, part.visit_id);
    await log(tx, userId, 'part_id_corrected', 'device', part.device_id, { visit_id: part.visit_id, event_id: eventId, from: part.hardware_id, to: id, reason: r });
  });
}

export interface VisitPatch { visitedOn?: string; technician?: string | null; outcome?: Outcome; salesforceCase?: string | null; salesforceWorkOrder?: string | null; notes?: string | null; documentId?: string | null }

/** Change the visit itself. A new date or outcome changes warranty coverage, so coverage is recalculated for its events, which is refused once any are invoiced. */
export async function correctVisit(db: Db, visitId: string, patch: VisitPatch, reason: string, userId: string | null): Promise<void> {
  const r = need(reason);
  const v = await one<{ id: string; property_id: string; visited_on: string; outcome: Outcome; technician: string | null; salesforce_case: string | null; salesforce_work_order: string | null; notes: string | null; document_id: string | null }>(db,
    `SELECT id, property_id, visited_on::text, outcome, technician, salesforce_case, salesforce_work_order, notes, document_id FROM visit WHERE id=$1`, [visitId]);
  if (!v) throw new ServiceError('Unknown visit.');
  const next = {
    visitedOn: patch.visitedOn ?? v.visited_on, outcome: patch.outcome ?? v.outcome,
    technician: 'technician' in patch ? patch.technician ?? null : v.technician,
    salesforceCase: 'salesforceCase' in patch ? patch.salesforceCase ?? null : v.salesforce_case,
    salesforceWorkOrder: 'salesforceWorkOrder' in patch ? patch.salesforceWorkOrder ?? null : v.salesforce_work_order,
    notes: 'notes' in patch ? patch.notes ?? null : v.notes,
    documentId: 'documentId' in patch ? patch.documentId ?? null : v.document_id,
  };
  if (next.documentId && next.documentId !== v.document_id) {
    const d = await one<{ property_id: string }>(db, `SELECT property_id FROM document WHERE id=$1`, [next.documentId]);
    if (!d || d.property_id !== v.property_id) throw new ServiceError('That work authorization belongs to another property.');
  }
  const coverageChanges = next.visitedOn !== v.visited_on || next.outcome !== v.outcome;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.visitedOn)) throw new ServiceError('Enter the date as YYYY-MM-DD.');
  const events = (await db.query<{ id: string; endpoint_id: string; action: string }>(`SELECT se.id, se.endpoint_id, se.action FROM service_event se WHERE se.visit_id=$1 AND ${LIVE_EVENT}`, [visitId])).rows;
  if (coverageChanges) {
    for (const e of events) if (await isInvoiced(db, e.id)) throw new ServiceError('Part of this visit has been invoiced, so its date and outcome can no longer change.');
    if (next.outcome !== 'completed' && events.some((e) => e.action === 'replace')) throw new ServiceError('A visit with replaced parts must stay "completed". Void the replacement first.');
  }
  const { warranty } = await loadSettings(db);
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE visit SET visited_on=$2, outcome=$3, technician=$4, salesforce_case=$5, salesforce_work_order=$6, notes=$7, document_id=$8, job_id=COALESCE((SELECT job_id FROM document WHERE id=$8), job_id) WHERE id=$1`,
      [visitId, next.visitedOn, next.outcome, next.technician, next.salesforceCase, next.salesforceWorkOrder, next.notes, next.documentId]);
    if (coverageChanges) {
      const prop = (await tx.query<{ installed_by_us: boolean; install_completed_on: string | null }>(`SELECT installed_by_us, install_completed_on::text FROM property WHERE id=$1`, [v.property_id])).rows[0];
      const touched = next.outcome === 'completed';
      for (const e of events) {
        const prior = await tx.query<{ visited_on: string; outcome: Outcome }>(
          `SELECT DISTINCT v2.visited_on::text, v2.outcome FROM service_event se JOIN visit v2 ON v2.id=se.visit_id
            WHERE se.endpoint_id=$1 AND se.visit_id<>$2 AND ${LIVE_EVENT}`, [e.endpoint_id, visitId]);
        const old = await one<{ on: string | null }>(tx,
          `SELECT max(i.installed_on)::text "on" FROM event_part ep JOIN installation i ON i.device_id=ep.old_device_id AND i.origin='service' WHERE ep.service_event_id=$1`, [e.id]);
        const cov = coverage({ installedByUs: prop.installed_by_us, installCompletedOn: prop.install_completed_on,
          endpointVisits: prior.rows.map((x) => ({ date: x.visited_on, outcome: x.outcome })), visitDate: next.visitedOn, devicePartInstalledOn: old?.on ?? null }, warranty);
        await tx.query(`UPDATE service_event SET labor_covered=$2, part_covered=$3, coverage_basis=$4 WHERE id=$1`,
          [e.id, touched && cov.laborCovered, touched && e.action === 'replace' && cov.partCovered, cov.basis]);
        if (next.visitedOn !== v.visited_on) {
          await tx.query(`UPDATE installation SET installed_on=$2 WHERE source_ref=$1`, [e.id, next.visitedOn]);
          await tx.query(`UPDATE installation SET removed_on=$3 WHERE removed_on=$2 AND device_id IN (SELECT old_device_id FROM event_part WHERE service_event_id=$1 AND old_device_id IS NOT NULL)`, [e.id, v.visited_on, next.visitedOn]);
        }
      }
    }
    await reopenNotes(tx, visitId);
    await log(tx, userId, 'visit_corrected', 'visit', visitId, { visit_id: visitId, reason: r, from: { visitedOn: v.visited_on, outcome: v.outcome, technician: v.technician, salesforceCase: v.salesforce_case, salesforceWorkOrder: v.salesforce_work_order, notes: v.notes, documentId: v.document_id }, to: next });
  });
}

export interface CorrectionEntry { at: string; by: string | null; action: string; reason: string | null; summary: string }

/** What was changed on a visit, newest first. */
export async function corrections(db: Db, visitId: string): Promise<CorrectionEntry[]> {
  const rows = await db.query<{ at: string; name: string | null; action: string; detail: Record<string, unknown> }>(
    `SELECT l.at::text, u.name, l.action, l.detail FROM audit_log l LEFT JOIN app_user u ON u.id=l.user_id
      WHERE l.action IN ('event_corrected','event_voided','part_id_corrected','visit_corrected') AND l.detail->>'visit_id' = $1 ORDER BY l.at DESC, l.id DESC`, [visitId]);
  const text = (a: string, d: Record<string, unknown>) => {
    if (a === 'event_voided') return 'Unit event voided';
    if (a === 'part_id_corrected') return `New part ID changed from ${d.from ?? '(none)'} to ${d.to}`;
    if (a === 'visit_corrected') return `Visit details changed (${Object.keys((d.to as object) ?? {}).filter((k) => JSON.stringify((d.to as Record<string, unknown>)[k]) !== JSON.stringify((d.from as Record<string, unknown>)?.[k])).join(', ') || 'no field'})`;
    return `Unit event corrected (${Object.keys((d.patch as object) ?? {}).join(', ')})`;
  };
  return rows.rows.map((r) => ({ at: r.at.slice(0, 16).replace('T', ' '), by: r.name, action: r.action, reason: (r.detail.reason as string | null) ?? null, summary: text(r.action, r.detail) }));
}
