// Warranty inputs, gathered in one place. Every quote, audit line, recorded visit and correction asks these
// functions, so the same unit on the same date always gets the same answer.
//  - Labor clock: the latest completed touch at the endpoint. A unit marked "unable to access" or "unable to
//    complete" on an otherwise completed visit is not a touch.
//  - Part clock: the service install date of the live device of the component being worked on (the
//    transmitter for transmitter work, the meter for meter work). Removed and voided devices never count.
import type { Db, Q } from '../db';
import { LIVE_EVENT } from '../sql';
import { coverage, type Coverage, type ServiceVisit, type WarrantySettings } from '../rules/warranty';


/** Service visits at each endpoint as warranty sees them, optionally leaving one visit out. */
export async function touchesFor(q: Q, endpointIds: string[], o: { excludeVisitId?: string } = {}): Promise<Map<string, ServiceVisit[]>> {
  const out = new Map<string, ServiceVisit[]>();
  if (!endpointIds.length) return out;
  const rows = (await q.query<{ endpoint_id: string; visited_on: string; outcome: ServiceVisit['outcome'] }>(
    `SELECT DISTINCT se.endpoint_id, v.visited_on::text,
            CASE WHEN se.result IN ('unable_to_access','unable_to_complete') THEN se.result ELSE v.outcome END outcome
       FROM service_event se JOIN visit v ON v.id=se.visit_id
      WHERE se.endpoint_id = ANY($1) AND ${LIVE_EVENT} AND ($2::uuid IS NULL OR se.visit_id <> $2)`,
    [endpointIds, o.excludeVisitId ?? null])).rows;
  for (const r of rows) out.set(r.endpoint_id, [...(out.get(r.endpoint_id) ?? []), { date: r.visited_on, outcome: r.outcome }]);
  return out;
}

/** Device kinds whose part warranty applies to work on a component. */
export const KINDS_FOR: Record<string, string[]> = { transmitter: ['transmitter', 'combo'], meter: ['meter', 'combo'], both: ['combo'], combo: ['combo'] };

/** Service install dates of the live devices at each endpoint, by kind (for part warranty). */
export async function serviceInstalls(q: Q, endpointIds: string[]): Promise<Map<string, { kind: string; on: string }[]>> {
  const out = new Map<string, { kind: string; on: string }[]>();
  if (!endpointIds.length) return out;
  const rows = (await q.query<{ endpoint_id: string; kind: string; on: string }>(
    `SELECT i.endpoint_id, d.kind, i.installed_on::text "on" FROM installation i JOIN device d ON d.id=i.device_id
      WHERE i.endpoint_id = ANY($1) AND i.origin='service' AND i.removed_on IS NULL AND d.status='active' AND i.installed_on IS NOT NULL`, [endpointIds])).rows;
  for (const r of rows) out.set(r.endpoint_id, [...(out.get(r.endpoint_id) ?? []), { kind: r.kind, on: r.on }]);
  return out;
}

/** The part clock for work on `component` at an endpoint, as of a date. Null when unknown or no component. */
export function partDate(installs: { kind: string; on: string }[] | undefined, component: string | null | undefined, asOf: string): string | null {
  const kinds = component ? KINDS_FOR[component] : undefined;
  if (!kinds || !installs) return null;
  return installs.filter((x) => kinds.includes(x.kind) && x.on <= asOf).map((x) => x.on).sort().pop() ?? null;
}

export interface PropertyWarranty { installedByUs: boolean; installCompletedOn: string | null }
export async function propertyWarranty(q: Q, propertyId: string): Promise<PropertyWarranty> {
  const r = (await q.query<{ installed_by_us: boolean; install_completed_on: string | null }>(
    `SELECT installed_by_us, install_completed_on::text FROM property WHERE id=$1`, [propertyId])).rows[0];
  return { installedByUs: !!r?.installed_by_us, installCompletedOn: r?.install_completed_on ?? null };
}

export function coverageFor(p: PropertyWarranty, visits: ServiceVisit[], visitDate: string, partInstalledOn: string | null, s: WarrantySettings): Coverage {
  return coverage({ installedByUs: p.installedByUs, installCompletedOn: p.installCompletedOn, endpointVisits: visits, visitDate, devicePartInstalledOn: partInstalledOn }, s);
}

/** The service install date of the device a replace event took out (its part clock). */
export async function replacedPartDate(q: Q, eventId: string): Promise<string | null> {
  return (await q.query<{ on: string | null }>(
    `SELECT max(i.installed_on)::text "on" FROM event_part ep JOIN installation i ON i.device_id=ep.old_device_id AND i.origin='service'
      WHERE ep.service_event_id=$1 AND i.endpoint_id = (SELECT endpoint_id FROM service_event WHERE id=$1)`, [eventId])).rows[0]?.on ?? null;
}

export interface Recalc { updated: string[]; review: { eventId: string; visitId: string; endpointId: string; visitedOn: string }[] }

/**
 * After history changes (a correction, a void, a back-dated visit), recalculate stored coverage on the live events
 * at these endpoints from `fromDate` on. Invoiced events are never changed; if their coverage would change they
 * are returned for review and logged.
 */
export async function recalcCoverage(q: Q, endpointIds: string[], fromDate: string, settings: WarrantySettings, userId: string | null): Promise<Recalc> {
  const out: Recalc = { updated: [], review: [] };
  if (!endpointIds.length) return out;
  const evs = (await q.query<{ id: string; visit_id: string; endpoint_id: string; action: string; labor_covered: boolean; part_covered: boolean; coverage_basis: string[];
    visited_on: string; outcome: string; property_id: string; invoiced: boolean }>(
    `SELECT se.id, se.visit_id, se.endpoint_id, se.action, se.labor_covered, se.part_covered, se.coverage_basis, v.visited_on::text, v.outcome, v.property_id,
            EXISTS (SELECT 1 FROM invoice_line il WHERE il.service_event_id=se.id) invoiced
       FROM service_event se JOIN visit v ON v.id=se.visit_id
      WHERE se.endpoint_id = ANY($1) AND ${LIVE_EVENT} AND v.visited_on >= $2 ORDER BY v.visited_on`, [endpointIds, fromDate])).rows;
  const props = new Map<string, PropertyWarranty>();
  for (const e of evs) {
    const p = props.get(e.property_id) ?? await propertyWarranty(q, e.property_id); props.set(e.property_id, p);
    const visits = (await touchesFor(q, [e.endpoint_id], { excludeVisitId: e.visit_id })).get(e.endpoint_id) ?? [];
    const cov = coverageFor(p, visits, e.visited_on, e.action === 'replace' ? await replacedPartDate(q, e.id) : null, settings);
    const touched = e.outcome === 'completed';
    const labor = touched && cov.laborCovered; const part = touched && e.action === 'replace' && cov.partCovered;
    if (labor === e.labor_covered && part === e.part_covered && JSON.stringify(cov.basis) === JSON.stringify(e.coverage_basis)) continue;
    if (e.invoiced) {
      if (labor !== e.labor_covered || part !== e.part_covered) out.review.push({ eventId: e.id, visitId: e.visit_id, endpointId: e.endpoint_id, visitedOn: e.visited_on });
      continue;
    }
    await q.query(`UPDATE service_event SET labor_covered=$2, part_covered=$3, coverage_basis=$4 WHERE id=$1`, [e.id, labor, part, cov.basis]);
    out.updated.push(e.id);
  }
  if (out.updated.length || out.review.length)
    await q.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'coverage_recalculated','service_event',$2,$3)`,
      [userId, out.updated[0] ?? out.review[0].eventId, JSON.stringify({ updated: out.updated, invoiced_needing_review: out.review.map((r) => r.eventId) })]);
  return out;
}
