// Post-service audit and After Action Report.
// For each unit serviced on a visit (or on every visit that worked one WA): what the audit found before,
// what the technician did, and what the first audit or check-in after the visit shows. The "after" judgement
// is the existing verification rule (verify.ts); this module only adds the "before" side and the summary.
import type { Db } from '../db';
import { closeoutData, type Closeout } from './closeout';
import { verifyVisit } from './verify';
import { RESULT_LABEL } from './phrases';

type Q = Pick<Db, 'query'>;
export type AarOutcome = 'fixed' | 'still_failing' | 'new_problem' | 'revisit' | 'awaiting_audit';
export const AAR_LABEL: Record<AarOutcome, string> = {
  fixed: 'Fixed', still_failing: 'Still failing', new_problem: 'New problem', revisit: 'Revisit needed', awaiting_audit: 'Awaiting audit',
};
const FAILING = ['NT', 'NI', 'INT', 'IDMM'];

export interface AarRow {
  visitId: string; visitedOn: string; eventId: string; endpointId: string; building: string; unit: string; service: string;
  before: { code: string | null; auditEnded: string | null };
  work: string; newTxId: string | null;
  after: { code: string | null; evidence: string; on: string | null };
  outcome: AarOutcome;
}
export interface Aar {
  property: Closeout['property']; document: { id: string; number: string; type: string } | null;
  visits: { id: string; visitedOn: string; technician: string | null; outcome: string }[];
  rows: AarRow[];
  summary: Record<AarOutcome, number> & { units: number; firstVisitFixed: number };
  postAuditDue: string | null;
}

/** Days after a visit when the post-service audit is due (setting post_audit_days, 7 unless changed). */
export async function postAuditDays(q: Q): Promise<number> {
  const r = (await q.query<{ value: unknown }>(`SELECT value FROM setting WHERE key='post_audit_days'`)).rows[0];
  const n = Number(r?.value); return Number.isFinite(n) && n > 0 ? n : 7;
}
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

async function before(q: Q, endpointId: string, visitedOn: string) {
  return (await q.query<{ code: string; ended: string }>(
    `SELECT upper(trim(r.audit_result)) code, GREATEST(r.read_date_1, r.read_date_2)::text ended FROM audit_reading r
      WHERE r.endpoint_id=$1 AND LEAST(r.read_date_1, r.read_date_2) < $2::date ORDER BY GREATEST(r.read_date_1, r.read_date_2) DESC LIMIT 1`, [endpointId, visitedOn])).rows[0] ?? null;
}
async function after(q: Q, endpointId: string, visitedOn: string) {
  return (await q.query<{ code: string }>(
    `SELECT upper(trim(r.audit_result)) code FROM audit_reading r
      WHERE r.endpoint_id=$1 AND LEAST(r.read_date_1, r.read_date_2) >= $2::date ORDER BY GREATEST(r.read_date_1, r.read_date_2) DESC LIMIT 1`, [endpointId, visitedOn])).rows[0]?.code ?? null;
}

async function visitRows(db: Db, visitId: string): Promise<{ c: Closeout; rows: AarRow[] }> {
  const c = await closeoutData(db, visitId);
  const checks = new Map((await verifyVisit(db, visitId)).map((v) => [v.eventId, v]));
  const rows: AarRow[] = [];
  for (const u of c.units) {
    const b = await before(db, u.endpointId, c.visit.visitedOn);
    const a = await after(db, u.endpointId, c.visit.visitedOn);
    const v = checks.get(u.eventId);
    const beforeCode = b?.code ?? u.issueCode?.toUpperCase() ?? null;
    let outcome: AarOutcome;
    if (u.result === 'unable_to_access' || u.result === 'unable_to_complete') outcome = 'revisit';
    else if (v?.status === 'verified') outcome = 'fixed';
    else if (v?.status === 'failed') outcome = a && beforeCode && a !== beforeCode && FAILING.includes(a) ? 'new_problem' : 'still_failing';
    else outcome = 'awaiting_audit';
    rows.push({
      visitId, visitedOn: c.visit.visitedOn, eventId: u.eventId, endpointId: u.endpointId, building: u.building, unit: u.unit, service: u.service,
      before: { code: beforeCode, auditEnded: b?.ended ?? null },
      work: [RESULT_LABEL[u.result], u.equipment && u.equipment !== '-' ? u.equipment : null].filter(Boolean).join(': '), newTxId: u.newTxId,
      after: { code: a, evidence: v?.evidence ?? 'No audit or check-in since the visit yet.', on: v?.on ?? null }, outcome,
    });
  }
  return { c, rows };
}

function summarize(rows: AarRow[]): Aar['summary'] {
  const s = { fixed: 0, still_failing: 0, new_problem: 0, revisit: 0, awaiting_audit: 0, units: 0, firstVisitFixed: 0 };
  const firstFor = new Map<string, AarRow>();
  for (const r of rows) { s[r.outcome]++; const f = firstFor.get(r.endpointId); if (!f || r.visitedOn < f.visitedOn) firstFor.set(r.endpointId, r); }
  s.units = firstFor.size;
  s.firstVisitFixed = [...firstFor.values()].filter((r) => r.outcome === 'fixed').length;
  return s;
}

/** After Action Report for one visit. */
export async function aarForVisit(db: Db, visitId: string): Promise<Aar> {
  const { c, rows } = await visitRows(db, visitId);
  const days = await postAuditDays(db);
  return {
    property: c.property, document: c.visit.documentId ? { id: c.visit.documentId, number: c.visit.documentNumber ?? '', type: 'WA' } : null,
    visits: [{ id: c.visit.id, visitedOn: c.visit.visitedOn, technician: c.visit.technician, outcome: c.visit.outcome }],
    rows, summary: summarize(rows), postAuditDue: addDays(c.visit.visitedOn, days),
  };
}

/** After Action Report for a WA: every visit linked to it. */
export async function aarForDocument(db: Db, documentId: string): Promise<Aar> {
  const d = (await db.query<{ id: string; number: string; type: string }>(`SELECT id, number, type FROM document WHERE id=$1`, [documentId])).rows[0];
  if (!d) throw new Error('Unknown document.');
  const vs = (await db.query<{ id: string }>(`SELECT id FROM visit WHERE document_id=$1 ORDER BY visited_on, created_at`, [documentId])).rows;
  if (!vs.length) throw new Error('No visits are linked to this document yet.');
  const parts = [];
  for (const v of vs) parts.push(await visitRows(db, v.id));
  const rows = parts.flatMap((p) => p.rows);
  const days = await postAuditDays(db);
  const last = parts[parts.length - 1].c.visit.visitedOn;
  return {
    property: parts[0].c.property, document: d,
    visits: parts.map((p) => ({ id: p.c.visit.id, visitedOn: p.c.visit.visitedOn, technician: p.c.visit.technician, outcome: p.c.visit.outcome })),
    rows, summary: summarize(rows), postAuditDue: addDays(last, days),
  };
}

/** Completed visits whose post-service audit is due but has not arrived (some units still "awaiting audit"). */
export async function postAuditsDue(db: Db, today: string, lookbackDays = 120) {
  const days = await postAuditDays(db);
  const vs = (await db.query<{ id: string; pid: string; name: string; on: string }>(
    `SELECT v.id, p.id pid, p.name, v.visited_on::text "on" FROM visit v JOIN property p ON p.id=v.property_id
      WHERE v.outcome='completed' AND v.visited_on <= $1::date - $2::int AND v.visited_on >= $1::date - $3::int ORDER BY v.visited_on`, [today, days, lookbackDays])).rows;
  const out: { visitId: string; propertyId: string; property: string; visitedOn: string; dueOn: string; waiting: number }[] = [];
  for (const v of vs) {
    const waiting = (await verifyVisit(db, v.id)).filter((x) => x.status === 'pending').length;
    if (waiting) out.push({ visitId: v.id, propertyId: v.pid, property: v.name, visitedOn: v.on, dueOn: addDays(v.on, days), waiting });
  }
  return out;
}
