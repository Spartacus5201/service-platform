// "Today": everything that is waiting on someone, across all properties. Each queue is one plain query or one
// pass over the unit stages, so a queue can be added or changed without touching the others.
import type { Db } from '../db';
import { can, canOwn, type Permission, type Session } from '../auth/auth';
import { ownVisit } from '../jobs/own';
import { followUps } from '../service/verify';
import { LIVE_EVENT } from '../service/record';
import { stagedLines, latestAuditBatch, countStages } from '../service/unitstatus';
import { postAuditsDue } from '../service/aar';
import { lowBatteryDevices } from '../service/battery';

/** Days an item may wait before it is shown as overdue. */
export const LIMITS = { idConfirm: 14, staleDraft: 30, notesApproval: 3, invoiceRef: 14, docVisit: 30 };

interface Item { propertyId: string; property: string; days: number }
export interface Queues {
  needsDocument: (Item & { batchId: string; count: number; auditedOn: string })[];
  revisit: (Item & { visitId: string; unit: string; service: string; result: string })[];
  notVisited: (Item & { documentId: string; number: string; units: number })[];
  draftNotes: (Item & { visitId: string; visitedOn: string; units: number })[];
  uninvoiced: (Item & { visitId: string; visitedOn: string; units: number })[];
  idUpdates: (Item & { visitId: string; visitedOn: string; rows: number })[];
  idUnconfirmed: (Item & { visitId: string; visitedOn: string; rows: number })[];
  invoiceNoRef: (Item & { visitId: string | null; submittedOn: string })[];
  staleDrafts: (Item & { documentId: string; number: string; type: string })[];
  failed: (Item & { visitId: string; unit: string; service: string; evidence: string })[];
  lowBattery: (Item & { count: number; oldest: string })[];
  importIssues: (Item & { count: number })[];
  readyToClose: (Item & { jobId: string; number: number; title: string })[];
  postAudit: (Item & { visitId: string; visitedOn: string; dueOn: string; waiting: number })[];
  /** The signed-in person's own recent visits (technicians), with how the work is holding. */
  myVisits: (Item & { visitId: string; visitedOn: string; units: number; fixed: number; failing: number; revisit: number; waiting: number })[];
  /** Units from the person's own visits that need a revisit. */
  myRevisits: (Item & { visitId: string; unit: string; service: string; result: string })[];
}
export type QueueKey = keyof Queues;

/**
 * Who sees which queue: anyone holding one of these permissions (for everything). The two "my" queues are for
 * whoever has visits of their own. Changing who sees what is a change to the role grid, not here.
 */
export const QUEUE_PERMS: Record<QueueKey, Permission[]> = {
  needsDocument: ['document.draft'], importIssues: ['import.run'], revisit: ['visit.record', 'job.manage'], failed: ['job.manage', 'visit.record'],
  postAudit: ['audit.review'], notVisited: ['visit.record', 'job.manage'], lowBattery: ['audit.review'], draftNotes: ['notes.approve'],
  uninvoiced: ['invoice.manage'], invoiceNoRef: ['invoice.manage'], idUpdates: ['idupdate.manage'], idUnconfirmed: ['idupdate.manage'],
  readyToClose: ['job.manage'], staleDrafts: ['document.draft'], myVisits: [], myRevisits: [],
};

/** What each built-in role sees first (docs/ROLES.md). Other queues the person may see follow in the usual order. */
export const ROLE_QUEUE_ORDER: Record<string, QueueKey[]> = {
  manager: ['readyToClose', 'failed', 'draftNotes', 'needsDocument'],
  coordinator: ['needsDocument', 'importIssues', 'failed', 'postAudit', 'draftNotes', 'idUpdates', 'idUnconfirmed', 'lowBattery', 'staleDrafts'],
  scheduler: ['notVisited', 'revisit', 'failed'],
  technician: ['myRevisits', 'myVisits'],
  billing: ['uninvoiced', 'invoiceNoRef'],
};
export const DEFAULT_ORDER: QueueKey[] = ['myRevisits', 'myVisits', 'needsDocument', 'importIssues', 'revisit', 'failed', 'postAudit', 'notVisited', 'lowBattery', 'draftNotes',
  'uninvoiced', 'invoiceNoRef', 'idUpdates', 'idUnconfirmed', 'readyToClose', 'staleDrafts'];

/**
 * The queues this person sees, in the order their roles put first (roles come in the roles' list order). The
 * "my" queues are only for people limited to their own visits; anyone who sees every visit has the full queues.
 */
export function queuesFor(s: Pick<Session, 'perms' | 'roles'>): QueueKey[] {
  const visible = (k: QueueKey) => (QUEUE_PERMS[k].length ? QUEUE_PERMS[k].some((p) => can(s, p)) : canOwn(s, 'visit.record') && !can(s, 'visit.record'));
  const order = [...new Set([...s.roles.flatMap((r) => ROLE_QUEUE_ORDER[r] ?? []), ...DEFAULT_ORDER])];
  return order.filter(visible);
}

const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));

/** Work out the queues. `only` limits the work to the queues someone will see; `userId` fills the "my" queues. */
export async function todayQueues(db: Db, today: string, o: { only?: QueueKey[]; userId?: string } = {}): Promise<Queues> {
  const q: Queues = { needsDocument: [], revisit: [], notVisited: [], draftNotes: [], uninvoiced: [], idUpdates: [], idUnconfirmed: [], invoiceNoRef: [], staleDrafts: [], failed: [], postAudit: [], lowBattery: [], readyToClose: [], importIssues: [], myVisits: [], myRevisits: [] };
  const want = (k: QueueKey) => !o.only || o.only.includes(k);
  const needStages = want('needsDocument') || want('revisit') || want('notVisited') || (want('myRevisits') && !!o.userId);
  const props = (await db.query<{ id: string; name: string }>(`SELECT id, name FROM property ORDER BY name`)).rows;
  for (const p of props) {
    const b = needStages ? await latestAuditBatch(db, p.id) : null;
    if (b) {
      const lines = await stagedLines(db, b.id, today);
      const c = countStages(lines);
      if (c.needs_document) q.needsDocument.push({ propertyId: p.id, property: p.name, batchId: b.id, count: c.needs_document, auditedOn: b.on, days: days(b.on, today) });
      const byDoc = new Map<string, { number: string; createdOn: string; units: number }>();
      for (const l of lines) {
        if (l.stage === 'revisit' && l.lastVisit) q.revisit.push({ propertyId: p.id, property: p.name, visitId: l.lastVisit.visitId, unit: `${l.building} ${l.unit}`, service: l.service, result: l.lastVisit.result ?? 'unable', days: days(l.lastVisit.visitedOn, today) });
        if (l.stage === 'on_document' && l.doc?.issued) {
          const d = byDoc.get(l.doc.id) ?? { number: l.doc.number, createdOn: l.doc.createdOn, units: 0 }; d.units++; byDoc.set(l.doc.id, d);
        }
      }
      for (const [documentId, d] of byDoc) q.notVisited.push({ propertyId: p.id, property: p.name, documentId, number: d.number, units: d.units, days: days(d.createdOn, today) });
    }
    const low = want('lowBattery') ? await lowBatteryDevices(db, { propertyId: p.id }) : [];
    if (low.length) { const oldest = low.map((d) => d.firstLowOn).filter(Boolean).sort()[0] ?? today; q.lowBattery.push({ propertyId: p.id, property: p.name, count: low.length, oldest, days: days(oldest, today) }); }
    if (want('failed')) for (const f of await followUps(db, p.id)) q.failed.push({ propertyId: p.id, property: p.name, visitId: f.visitId, unit: `${f.building} ${f.unit}`, service: f.service, evidence: f.evidence, days: days(f.on ?? f.visitedOn, today) });
  }

  type V = { id: string; pid: string; name: string; on: string; since: string; n: string };
  const visits = (sql: string) => db.query<V>(sql).then((r) => r.rows.map((x) => ({ visitId: x.id, propertyId: x.pid, property: x.name, visitedOn: x.on, n: Number(x.n), days: days(x.since, today) })));

  if (want('draftNotes')) q.draftNotes = (await visits(
    `SELECT v.id, p.id pid, p.name, v.visited_on::text "on", v.visited_on::text since, count(*) n
       FROM visit v JOIN property p ON p.id=v.property_id JOIN service_event se ON se.visit_id=v.id
      WHERE v.notes_status='draft' AND ${LIVE_EVENT} GROUP BY v.id, p.id ORDER BY v.visited_on`)).map(({ n, ...x }) => ({ ...x, units: n }));
  if (want('uninvoiced')) q.uninvoiced = (await visits(
    `SELECT v.id, p.id pid, p.name, v.visited_on::text "on", v.approved_at::date::text since, count(*) n
       FROM visit v JOIN property p ON p.id=v.property_id JOIN service_event se ON se.visit_id=v.id
      WHERE v.notes_status='approved' AND ${LIVE_EVENT} AND NOT EXISTS (SELECT 1 FROM invoice_line il WHERE il.service_event_id=se.id)
      GROUP BY v.id, p.id ORDER BY v.visited_on`)).map(({ n, ...x }) => ({ ...x, units: n }));
  if (want('idUpdates')) q.idUpdates = (await visits(
    `SELECT v.id, p.id pid, p.name, v.visited_on::text "on", COALESCE(v.approved_at::date, v.visited_on)::text since, count(*) n
       FROM id_update i JOIN visit v ON v.id=i.visit_id JOIN property p ON p.id=v.property_id
      WHERE i.status='pending' GROUP BY v.id, p.id ORDER BY v.visited_on`)).map(({ n, ...x }) => ({ ...x, rows: n }));
  if (want('idUnconfirmed')) q.idUnconfirmed = (await visits(
    `SELECT v.id, p.id pid, p.name, v.visited_on::text "on", min(i.exported_at)::date::text since, count(*) n
       FROM id_update i JOIN visit v ON v.id=i.visit_id JOIN property p ON p.id=v.property_id
      WHERE i.status='exported' GROUP BY v.id, p.id ORDER BY v.visited_on`))
    .filter((x) => x.days >= LIMITS.idConfirm).map(({ n, ...x }) => ({ ...x, rows: n }));

  if (want('invoiceNoRef')) q.invoiceNoRef = (await db.query<{ pid: string; name: string; on: string; visit_id: string | null }>(
    `SELECT p.id pid, p.name, s.submitted_on::text "on",
            (SELECT se.visit_id FROM invoice_line il JOIN service_event se ON se.id=il.service_event_id WHERE il.submission_id=s.id LIMIT 1) visit_id
       FROM invoice_submission s JOIN property p ON p.id=s.property_id
      WHERE COALESCE(trim(s.external_ref),'')='' ORDER BY s.submitted_on`)).rows
    .map((r) => ({ propertyId: r.pid, property: r.name, visitId: r.visit_id, submittedOn: r.on, days: days(r.on, today) }));

  if (want('staleDrafts')) q.staleDrafts = (await db.query<{ id: string; pid: string; name: string; number: string; type: string; on: string }>(
    `SELECT d.id, p.id pid, p.name, d.number, d.type, d.created_on::text "on" FROM document d JOIN property p ON p.id=d.property_id
      WHERE NOT EXISTS (SELECT 1 FROM document_version v WHERE v.document_id=d.id AND v.status='issued') ORDER BY d.created_on`)).rows
    .map((r) => ({ propertyId: r.pid, property: r.name, documentId: r.id, number: r.number, type: r.type, days: days(r.on, today) }))
    .filter((x) => x.days >= LIMITS.staleDraft);
  if (want('postAudit')) q.postAudit = (await postAuditsDue(db, today)).map((x) => ({ ...x, days: days(x.dueOn, today) }));
  const { openIssues } = await import('../import/issues');
  const iss = want('importIssues') ? await openIssues(db) : [];
  if (iss.length) for (const p of props) {
    const mine = iss.filter((i) => i.propertyId === p.id);
    if (mine.length) q.importIssues.push({ propertyId: p.id, property: p.name, count: mine.length, days: days(mine.map((i) => i.createdOn).sort()[0], today) });
  }
  if (o.userId && (want('myVisits') || want('myRevisits'))) {
    const mine = (await db.query<{ id: string; pid: string; name: string; on: string }>(
      `SELECT v.id, p.id pid, p.name, v.visited_on::text "on" FROM visit v JOIN property p ON p.id=v.property_id
        WHERE ${ownVisit('$1')} AND v.visited_on >= $2::date - 60 ORDER BY v.visited_on DESC LIMIT 20`, [o.userId, today])).rows;
    const { aarForVisit } = await import('../service/aar');
    for (const v of mine) {
      const { summary: m } = await aarForVisit(db, v.id);
      q.myVisits.push({ propertyId: v.pid, property: v.name, visitId: v.id, visitedOn: v.on, units: m.units, fixed: m.fixed, failing: m.still_failing + m.new_problem, revisit: m.revisit, waiting: m.awaiting_audit, days: days(v.on, today) });
    }
    const ids = new Set(mine.map((v) => v.id));
    q.myRevisits = q.revisit.filter((r) => ids.has(r.visitId));
  }
  if (!want('revisit')) q.revisit = [];
  if (!want('needsDocument')) q.needsDocument = [];
  if (!want('notVisited')) q.notVisited = [];
  const { listJobs } = await import('../jobs/jobs');
  if (want('readyToClose')) q.readyToClose = (await listJobs(db)).filter((j) => j.stage === 'ready').map((j) => ({ propertyId: j.propertyId, property: j.property, jobId: j.id, number: j.number, title: j.title, days: days(j.since, today) }));
  return q;
}

export const queueTotal = (q: Queues) => Object.values(q).reduce((n, a) => n + a.length, 0);
