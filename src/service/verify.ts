// Did the work stick? After a visit, later audits and CIM check-ins show whether each touched unit is healthy again.
// Derived from imported data each time it is asked for, so it is always consistent with what has been imported.
import type { Db } from '../db';
import { LIVE_EVENT } from './record';

type Q = Pick<Db, 'query'>;
export type VerifyStatus = 'pending' | 'verified' | 'failed';

export interface UnitVerification {
  eventId: string; endpointId: string; building: string; unit: string; service: string; issueCode: string | null;
  status: VerifyStatus; evidence: string; on: string | null;
}

const EQUIPMENT_CODES = ['NT', 'NI', 'INT', 'IDMM'];
const TX_ISSUES = ['NT', 'INT', 'IDMM'];

interface EventRow { id: string; endpoint_id: string; building: string; unit: string; service_code: string; issue_code: string | null; action: string; outcome: string; visited_on: string; vacant: boolean;
  old_mdid: string | null; new_mdid: string | null; replaced_tx: boolean }

async function load(q: Q, where: string, args: unknown[]): Promise<EventRow[]> {
  return (await q.query<EventRow>(
    `SELECT se.id, se.endpoint_id, b.label building, u.current_label unit, e.service_code, se.issue_code, se.action, v.outcome, v.visited_on::text,
            (u.occupancy_as_of IS NOT NULL AND u.move_in_on IS NULL) vacant,
            (SELECT od.hardware_id FROM event_part ep JOIN device od ON od.id=ep.old_device_id WHERE ep.service_event_id=se.id AND od.kind<>'meter' LIMIT 1) old_mdid,
            (SELECT nd.hardware_id FROM event_part ep JOIN device nd ON nd.id=ep.new_device_id WHERE ep.service_event_id=se.id AND nd.kind<>'meter' LIMIT 1) new_mdid,
            EXISTS (SELECT 1 FROM event_part ep JOIN device nd ON nd.id=ep.new_device_id WHERE ep.service_event_id=se.id AND nd.kind<>'meter') replaced_tx
       FROM service_event se JOIN visit v ON v.id=se.visit_id JOIN endpoint e ON e.id=se.endpoint_id JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id
      WHERE ${where} AND ${LIVE_EVENT} ORDER BY b.label, u.current_label, e.service_code`, args)).rows;
}

async function check(q: Q, e: EventRow): Promise<UnitVerification> {
  const base = { eventId: e.id, endpointId: e.endpoint_id, building: e.building, unit: e.unit, service: e.service_code, issueCode: e.issue_code };
  if (e.outcome !== 'completed') return { ...base, status: 'pending', evidence: 'Visit not completed; needs rescheduling.', on: null };

  // An audit is conclusive only if its whole window (either date column can be the earlier one) is on or after the visit.
  const audit = (await q.query<{ audit_result: string; amr_id: string | null; on: string }>(
    `SELECT r.audit_result, r.amr_id, GREATEST(r.read_date_1, r.read_date_2, i.imported_at::date)::text "on"
       FROM audit_reading r JOIN import_batch i ON i.id=r.import_batch_id
      WHERE r.endpoint_id=$1 AND LEAST(r.read_date_1, r.read_date_2) >= $2::date ORDER BY GREATEST(r.read_date_1, r.read_date_2) DESC, i.imported_at DESC LIMIT 1`, [e.endpoint_id, e.visited_on])).rows[0];
  const txRelated = e.replaced_tx || TX_ISSUES.includes((e.issue_code ?? '').toUpperCase());
  const checkin = txRelated ? (await q.query<{ on: string }>(
    `SELECT max(c.checked_in_at)::date::text "on" FROM device_checkin c JOIN device d ON d.id=c.device_id JOIN installation i ON i.device_id=d.id
      WHERE i.endpoint_id=$1 AND d.kind<>'meter' AND i.removed_on IS NULL AND d.status='active' AND c.checked_in_at::date > $2::date`, [e.endpoint_id, e.visited_on])).rows[0] : undefined;

  const evAudit = audit ? { on: audit.on, rank: 1 } : null;
  const evCheck = checkin?.on ? { on: checkin.on, rank: 0 } : null;
  const useAudit = evAudit && (!evCheck || evAudit.on >= evCheck.on);

  if (useAudit && audit) {
    const code = (audit.audit_result ?? '').trim().toUpperCase();
    if (e.replaced_tx && e.old_mdid && audit.amr_id === e.old_mdid && audit.amr_id !== e.new_mdid)
      return { ...base, status: 'failed', evidence: `Audit ending ${audit.on} still lists the old ID ${e.old_mdid}. The billing system or read file needs the new ID ${e.new_mdid ?? ''}.`, on: audit.on };
    if (code === 'OK') return { ...base, status: 'verified', evidence: `Audit ending ${audit.on}: OK.`, on: audit.on };
    if (code === 'NI' && e.vacant) return { ...base, status: 'verified', evidence: `Audit ending ${audit.on}: no increment on a vacant unit.`, on: audit.on };
    if (EQUIPMENT_CODES.includes(code)) return { ...base, status: 'failed', evidence: `Audit ending ${audit.on} still reports ${code}.`, on: audit.on };
    return { ...base, status: 'pending', evidence: `Audit ending ${audit.on} reports ${code || 'no result'}; property to investigate usage.`, on: audit.on };
  }
  if (evCheck) return { ...base, status: 'verified', evidence: `Transmitter checked in ${evCheck.on}.`, on: evCheck.on };
  return { ...base, status: 'pending', evidence: 'No audit or check-in since the visit yet.', on: null };
}

export async function verifyVisit(db: Q, visitId: string): Promise<UnitVerification[]> {
  const evs = await load(db, `se.visit_id=$1`, [visitId]);
  return Promise.all(evs.map((e) => check(db, e)));
}

/** Units whose latest service did not fix the problem, across the property. */
export async function followUps(db: Q, propertyId: string): Promise<(UnitVerification & { visitId: string; visitedOn: string })[]> {
  const evs = await load(db, `v.property_id=$1 AND NOT EXISTS (
      SELECT 1 FROM service_event s3 JOIN visit v3 ON v3.id=s3.visit_id WHERE s3.endpoint_id=se.endpoint_id AND NOT s3.voided
        AND NOT EXISTS (SELECT 1 FROM service_event s4 WHERE s4.supersedes=s3.id) AND (v3.visited_on > v.visited_on OR (v3.visited_on = v.visited_on AND s3.created_at > se.created_at)))`, [propertyId]);
  const out = [];
  for (const e of evs) {
    const r = await check(db, e);
    if (r.status !== 'failed') continue;
    const visit = (await db.query<{ visit_id: string }>(`SELECT visit_id FROM service_event WHERE id=$1`, [e.id])).rows[0].visit_id;
    out.push({ ...r, visitId: visit, visitedOn: e.visited_on });
  }
  return out;
}

/** An ID update is confirmed when a later audit or check-in shows the new transmitter ID. Returns how many rows changed. */
export async function confirmIdUpdates(db: Q, propertyId: string): Promise<number> {
  const rows = (await db.query<{ id: string; new_mdid: string; endpoint_id: string; visited_on: string }>(
    `SELECT i.id, i.new_mdid, i.endpoint_id, v.visited_on::text FROM id_update i JOIN visit v ON v.id=i.visit_id
      WHERE v.property_id=$1 AND i.status<>'confirmed' AND i.new_mdid IS NOT NULL AND i.new_mdid <> COALESCE(i.old_mdid,'')`, [propertyId])).rows;
  let n = 0;
  for (const r of rows) {
    const a = (await db.query<{ import_batch_id: string }>(
      `SELECT r.import_batch_id FROM audit_reading r WHERE r.endpoint_id=$1 AND r.amr_id=$2 AND LEAST(r.read_date_1, r.read_date_2) >= $3::date ORDER BY GREATEST(r.read_date_1, r.read_date_2) DESC LIMIT 1`, [r.endpoint_id, r.new_mdid, r.visited_on])).rows[0];
    const c = a ? null : (await db.query<{ import_batch_id: string }>(
      `SELECT c.import_batch_id FROM device_checkin c JOIN device d ON d.id=c.device_id WHERE d.hardware_id=$1 AND d.property_id=$2 AND c.checked_in_at::date >= $3::date ORDER BY c.checked_in_at DESC LIMIT 1`, [r.new_mdid, propertyId, r.visited_on])).rows[0];
    const batch = a?.import_batch_id ?? c?.import_batch_id;
    if (!batch) continue;
    await db.query(`UPDATE id_update SET status='confirmed', confirmed_at=now(), confirmed_by_batch=$2 WHERE id=$1`, [r.id, batch]);
    n++;
  }
  return n;
}
