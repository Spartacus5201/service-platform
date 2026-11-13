// Recording service work. Events are append-only: a correction is a new event that supersedes the old one.
import type { Db } from '../db';
import { coverage, type ServiceVisit } from '../rules/warranty';
import { loadSettings } from '../queries/audit';

export class ServiceError extends Error {}

export type Outcome = 'completed' | 'unable_to_access' | 'unable_to_complete';
export type Action = 'inspect_test' | 'repair' | 'replace' | 'reprogram' | 'other';
export type Result = 'repaired' | 'replaced' | 'reprogrammed' | 'no_fault_found' | 'unable_to_access' | 'unable_to_complete' | 'other';
export type PartKind = 'transmitter' | 'meter' | 'combo';

export interface Replacement {
  kind: PartKind;
  /** Defaults to the device currently installed at the endpoint for this kind. */
  oldDeviceId?: string;
  newHardwareId?: string | null;        // radio ID; meters have none
  newSerial?: string | null;            // optional on every device
  model?: string | null;
  catalogItemId?: string | null;
  quantity?: number;
}

export interface EventInput {
  endpointId: string;
  action: Action;
  issueCode?: string | null;
  readAtService?: number | null;
  endRead?: number | null;
  result?: Result | null;
  notes?: string | null;
  replacements?: Replacement[];
}

export interface VisitInput {
  propertyId: string;
  visitedOn: string;                     // ISO date
  technician?: string | null;
  outcome: Outcome;
  salesforceCase?: string | null;
  salesforceWorkOrder?: string | null;
  documentId?: string | null;            // the WA this visit closes
  notes?: string | null;
  createdBy?: string | null;
  events: EventInput[];
}

export interface RecordResult { visitId: string; eventIds: string[]; warnings: string[] }

type Q = Pick<Db, 'query'>;
const one = async <T>(q: Q, sql: string, p: unknown[] = []) => (await q.query<T>(sql, p)).rows[0] as T | undefined;

/** Service events that still stand (not replaced by a correction). */
export const LIVE_EVENT = `(NOT se.voided AND NOT EXISTS (SELECT 1 FROM service_event s2 WHERE s2.supersedes = se.id))`;

export async function recordVisit(db: Db, input: VisitInput): Promise<RecordResult> {
  if (!input.events.length) throw new ServiceError('A visit needs at least one event.');
  const touched = input.outcome === 'completed';
  for (const e of input.events) {
    if (!touched && e.replacements?.length) throw new ServiceError('Parts cannot be replaced on a visit that was not completed.');
    if (e.action === 'replace' && !e.replacements?.length) throw new ServiceError('A replace event needs at least one replacement.');
    if (e.action !== 'replace' && e.replacements?.length) throw new ServiceError('Replacements belong on a replace event.');
  }
  const { warranty } = await loadSettings(db);
  const prop = await one<{ installed_by_us: boolean; install_completed_on: string | null }>(db,
    `SELECT installed_by_us, install_completed_on::text FROM property WHERE id=$1`, [input.propertyId]);
  if (!prop) throw new ServiceError('Unknown property.');
  if (input.documentId) {
    const d = await one<{ property_id: string; salesforce_case: string | null; salesforce_work_order: string | null }>(db,
      `SELECT property_id, salesforce_case, salesforce_work_order FROM document WHERE id=$1`, [input.documentId]);
    if (!d || d.property_id !== input.propertyId) throw new ServiceError('That work authorization belongs to another property.');
    // The visit inherits the WA's Salesforce references unless the report gave its own.
    input = { ...input, salesforceCase: input.salesforceCase || d.salesforce_case, salesforceWorkOrder: input.salesforceWorkOrder || d.salesforce_work_order };
  }

  const warnings: string[] = [];
  const eventIds: string[] = [];
  let visitId = '';
  await db.transaction(async (tx) => {
    visitId = (await one<{ id: string }>(tx,
      `INSERT INTO visit (property_id,visited_on,technician,outcome,salesforce_case,salesforce_work_order,notes,created_by,document_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [input.propertyId, input.visitedOn, input.technician ?? null, input.outcome, input.salesforceCase ?? null,
       input.salesforceWorkOrder ?? null, input.notes ?? null, input.createdBy ?? null, input.documentId ?? null]))!.id;

    for (const e of input.events) {
      const ep = await one<{ property_id: string }>(tx,
        `SELECT b.property_id FROM endpoint e JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id WHERE e.id=$1`, [e.endpointId]);
      if (!ep || ep.property_id !== input.propertyId) throw new ServiceError('Endpoint does not belong to this property.');

      // Warranty position as of this visit, from history strictly before it.
      const prior = await tx.query<{ visited_on: string; outcome: ServiceVisit['outcome'] }>(
        `SELECT DISTINCT v.visited_on::text, v.outcome FROM service_event se JOIN visit v ON v.id=se.visit_id
          WHERE se.endpoint_id=$1 AND ${LIVE_EVENT}`, [e.endpointId]);
      const oldDevices = await resolveOldDevices(tx, e);
      const partInstalledOn = oldDevices.map((d) => d?.service_installed_on ?? null).filter(Boolean).sort().pop() ?? null;
      const cov = coverage({
        installedByUs: prop.installed_by_us, installCompletedOn: prop.install_completed_on,
        endpointVisits: prior.rows.map((r) => ({ date: r.visited_on, outcome: r.outcome })),
        visitDate: input.visitedOn, devicePartInstalledOn: partInstalledOn,
      }, warranty);

      const ev = await one<{ id: string }>(tx,
        `INSERT INTO service_event (visit_id,endpoint_id,action,issue_code,read_at_service,notes,created_by,labor_covered,part_covered,coverage_basis,result,end_read)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [visitId, e.endpointId, e.action, e.issueCode ?? null, e.readAtService ?? null, e.notes ?? null, input.createdBy ?? null,
         touched && cov.laborCovered, touched && e.action === 'replace' && cov.partCovered, cov.basis, e.result ?? null, e.endRead ?? null]);
      eventIds.push(ev!.id);

      for (const [i, r] of (e.replacements ?? []).entries()) {
        await applyReplacement(tx, input, e, ev!.id, r, oldDevices[i] ?? null, warnings);
      }
    }
  });
  return { visitId, eventIds, warnings };
}

interface OldDevice { id: string; installation_id: string; service_installed_on: string | null }

/** The device each replacement removes: the one named, or the active device of that kind at the endpoint. */
async function resolveOldDevices(q: Q, e: EventInput): Promise<(OldDevice | null)[]> {
  const out: (OldDevice | null)[] = [];
  for (const r of e.replacements ?? []) {
    const row = r.oldDeviceId
      ? await one<OldDevice & { origin: string; installed_on: string | null }>(q,
          `SELECT d.id, i.id installation_id, i.origin, i.installed_on::text FROM installation i JOIN device d ON d.id=i.device_id
            WHERE d.id=$1 AND i.endpoint_id=$2 AND i.removed_on IS NULL`, [r.oldDeviceId, e.endpointId])
      : await one<OldDevice & { origin: string; installed_on: string | null }>(q,
          `SELECT d.id, i.id installation_id, i.origin, i.installed_on::text FROM installation i JOIN device d ON d.id=i.device_id
            WHERE i.endpoint_id=$1 AND d.kind=$2 AND i.removed_on IS NULL AND d.status='active' ORDER BY i.installed_on DESC NULLS LAST LIMIT 1`,
          [e.endpointId, r.kind]);
    if (r.oldDeviceId && !row) throw new ServiceError('The device being replaced is not installed at this endpoint.');
    out.push(row ? { id: row.id, installation_id: row.installation_id, service_installed_on: row.origin === 'service' ? row.installed_on : null } : null);
  }
  return out;
}

async function applyReplacement(q: Q, v: VisitInput, e: EventInput, eventId: string, r: Replacement, old: OldDevice | null, warnings: string[]) {
  if (r.newHardwareId) {
    const dup = await one(q, `SELECT 1 FROM device WHERE property_id=$1 AND kind=$2 AND hardware_id=$3 AND status='active'`, [v.propertyId, r.kind, r.newHardwareId]);
    if (dup) throw new ServiceError(`A ${r.kind} with ID ${r.newHardwareId} is already active at this property.`);
  }
  if (old) {
    await q.query(`UPDATE installation SET removed_on=$2 WHERE id=$1`, [old.installation_id, v.visitedOn]);
    await q.query(`UPDATE device SET status='retired' WHERE id=$1`, [old.id]);
  } else warnings.push(`No ${r.kind} was on record at this endpoint; the replacement was added without retiring one.`);

  const placeholder = r.kind !== 'transmitter' && !r.newSerial && !r.newHardwareId;
  const dev = await one<{ id: string }>(q,
    `INSERT INTO device (property_id,kind,hardware_id,serial_number,model,is_placeholder) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [v.propertyId, r.kind, r.newHardwareId ?? null, r.newSerial ?? null, r.model ?? null, placeholder]);
  await q.query(`INSERT INTO installation (device_id,property_id,endpoint_id,installed_on,origin,source_ref) VALUES ($1,$2,$3,$4,'service',$5)`,
    [dev!.id, v.propertyId, e.endpointId, v.visitedOn, eventId]);
  await q.query(`INSERT INTO event_part (service_event_id,catalog_item_id,old_device_id,new_device_id,quantity) VALUES ($1,$2,$3,$4,$5)`,
    [eventId, r.catalogItemId ?? null, old?.id ?? null, dev!.id, r.quantity ?? 1]);
}

export interface EventPatch { issueCode?: string | null; notes?: string | null; readAtService?: number | null; endRead?: number | null; result?: Result | null; action?: Exclude<Action, 'replace'> }

/** Correct an event without losing the original. Refused once invoiced, and for replace events (their parts moved devices). */
export async function correctEvent(db: Db, eventId: string, patch: EventPatch, userId?: string | null, reason?: string | null): Promise<string> {
  const ev = await one<{ id: string; visit_id: string; endpoint_id: string; action: Action; issue_code: string | null; read_at_service: string | null; notes: string | null; result: Result | null; end_read: string | null;
    labor_covered: boolean; part_covered: boolean; coverage_basis: string[]; live: boolean }>(db,
    `SELECT se.*, ${LIVE_EVENT} AS live FROM service_event se WHERE se.id=$1`, [eventId]);
  if (!ev) throw new ServiceError('Unknown event.');
  if (!ev.live) throw new ServiceError('That event was already corrected; correct the latest version.');
  if (ev.action === 'replace') throw new ServiceError('A replace event cannot be edited in place; record a new visit.');
  const inv = await one(db, `SELECT 1 FROM invoice_line WHERE service_event_id=$1`, [eventId]);
  if (inv) throw new ServiceError('This event has been invoiced and can no longer be corrected.');
  const next = await one<{ id: string }>(db,
    `INSERT INTO service_event (visit_id,endpoint_id,action,issue_code,read_at_service,notes,supersedes,created_by,labor_covered,part_covered,coverage_basis,result,end_read)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [ev.visit_id, ev.endpoint_id, patch.action ?? ev.action,
     'issueCode' in patch ? patch.issueCode : ev.issue_code,
     'readAtService' in patch ? patch.readAtService : ev.read_at_service,
     'notes' in patch ? patch.notes : ev.notes,
     ev.id, userId ?? null, ev.labor_covered, ev.part_covered, ev.coverage_basis,
     'result' in patch ? patch.result : ev.result, 'endRead' in patch ? patch.endRead : ev.end_read]);
  // The client wording follows the event it describes.
  await db.query(`INSERT INTO event_note (service_event_id,client_comment,extra_comment,updated_by) SELECT $2, client_comment, extra_comment, $3 FROM event_note WHERE service_event_id=$1`, [ev.id, next!.id, userId ?? null]);
  await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'event_corrected','service_event',$2,$3)`,
    [userId ?? null, next!.id, JSON.stringify({ supersedes: ev.id, visit_id: ev.visit_id, patch, reason: reason ?? null })]);
  return next!.id;
}
