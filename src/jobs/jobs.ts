// Jobs: one piece of work for one property, from the request to the invoice.
// Stage, timeline and money are all derived from what is linked to the job (audit, documents, visits,
// invoicing, ID updates, post-service audit). Only the request and the close are typed in.
// Authorization and scheduling live on the Salesforce case; salesforce_status mirrors it.
import type { Db } from '../db';
import { aarForVisit, type AarOutcome } from '../service/aar';
import { lineTotal } from '../documents/render';

type Q = Pick<Db, 'query'>;
export class JobError extends Error {}

export type JobSource = 'salesforce' | 'phone' | 'email' | 'audit' | 'other';
export const SOURCE_LABEL: Record<JobSource, string> = { salesforce: 'Salesforce case', phone: 'Phone', email: 'Email', audit: 'Audit', other: 'Other' };

export type JobStage = 'requested' | 'audited' | 'drafting' | 'quoted' | 'serviced' | 'to_invoice' | 'follow_up' | 'verifying' | 'ready' | 'closed';
export const STAGES: JobStage[] = ['requested', 'audited', 'drafting', 'quoted', 'serviced', 'to_invoice', 'follow_up', 'verifying', 'ready', 'closed'];
export const STAGE: Record<JobStage, { label: string; next: string }> = {
  requested: { label: 'Requested', next: 'Import or attach the audit, or draft a document.' },
  audited: { label: 'Audited', next: 'Draft the WA, Proposal or RFM.' },
  drafting: { label: 'Document drafted', next: 'Review and issue the document.' },
  quoted: { label: 'Quoted', next: 'Authorization and scheduling on the Salesforce case. Record the service report after the visit.' },
  serviced: { label: 'Serviced', next: 'Process the technician notes and approve the client wording.' },
  to_invoice: { label: 'Notes approved', next: 'Send the invoicing sheet to admin.' },
  follow_up: { label: 'Follow-up needed', next: 'Units still failing or needing a revisit. Schedule the return visit.' },
  verifying: { label: 'Verifying', next: 'Waiting on the post-service audit, ID update confirmation or the invoice number.' },
  ready: { label: 'Ready to close', next: 'Everything is done. Close the job.' },
  closed: { label: 'Closed', next: '' },
};

export interface JobInput {
  propertyId: string; title: string; source?: JobSource; requestedOn: string; requestedBy?: string | null;
  requestNotes?: string | null; salesforceCase?: string | null; salesforceStatus?: string | null; createdBy?: string | null;
}

const one = async <T>(q: Q, sql: string, p: unknown[] = []) => (await q.query<T>(sql, p)).rows[0] as T | undefined;

export async function createJob(q: Q, j: JobInput): Promise<string> {
  if (!j.title.trim()) throw new JobError('Give the job a short title.');
  return (await one<{ id: string }>(q,
    `INSERT INTO job (property_id,title,source,requested_on,requested_by,request_notes,salesforce_case,salesforce_status,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [j.propertyId, j.title.trim(), j.source ?? 'other', j.requestedOn, j.requestedBy ?? null, j.requestNotes ?? null, j.salesforceCase ?? null, j.salesforceStatus ?? null, j.createdBy ?? null]))!.id;
}

export async function updateJob(q: Q, id: string, j: Omit<JobInput, 'propertyId' | 'createdBy'>): Promise<void> {
  if (!j.title.trim()) throw new JobError('Give the job a short title.');
  await q.query(`UPDATE job SET title=$2, source=$3, requested_on=$4, requested_by=$5, request_notes=$6, salesforce_case=$7, salesforce_status=$8 WHERE id=$1`,
    [id, j.title.trim(), j.source ?? 'other', j.requestedOn, j.requestedBy ?? null, j.requestNotes ?? null, j.salesforceCase ?? null, j.salesforceStatus ?? null]);
}

export async function closeJob(q: Q, id: string, on: string, reason: string | null, early: boolean): Promise<void> {
  if (early && !reason?.trim()) throw new JobError('Say why the job is being closed before the work is finished.');
  await q.query(`UPDATE job SET closed_on=$2, close_reason=$3 WHERE id=$1`, [id, on, reason?.trim() || null]);
}
export async function reopenJob(q: Q, id: string): Promise<void> { await q.query(`UPDATE job SET closed_on=NULL, close_reason=NULL WHERE id=$1`, [id]); }

/** Attach an audit import to a job (an audit belongs to at most one job). */
export async function attachAudit(q: Q, jobId: string, batchId: string): Promise<void> {
  const j = await one<{ property_id: string }>(q, `SELECT property_id FROM job WHERE id=$1`, [jobId]);
  const b = await one<{ property_id: string; job_id: string | null }>(q, `SELECT property_id, job_id FROM import_batch WHERE id=$1`, [batchId]);
  if (!j || !b || j.property_id !== b.property_id) throw new JobError('That audit belongs to another property.');
  if (b.job_id && b.job_id !== jobId) throw new JobError('That audit is already attached to another job.');
  await q.query(`UPDATE import_batch SET job_id=$2 WHERE id=$1`, [batchId, jobId]);
}

/** Which job a new document goes on: the one given, else the audit's job, else a new job started from the audit. */
export async function jobForDocument(q: Q, o: { propertyId: string; jobId: string | null; batchId: string | null; title: string; requestedOn: string; salesforceCase: string | null; createdBy: string | null }): Promise<string> {
  if (o.jobId) {
    const j = await one<{ property_id: string; closed_on: string | null }>(q, `SELECT property_id, closed_on FROM job WHERE id=$1`, [o.jobId]);
    if (!j || j.property_id !== o.propertyId) throw new JobError('That job belongs to another property.');
    if (o.batchId) await attachAudit(q, o.jobId, o.batchId).catch(() => undefined);
    return o.jobId;
  }
  if (o.batchId) {
    const b = await one<{ job_id: string | null }>(q, `SELECT job_id FROM import_batch WHERE id=$1`, [o.batchId]);
    if (b?.job_id) return b.job_id;
  }
  const id = await createJob(q, { propertyId: o.propertyId, title: o.title, source: o.batchId ? 'audit' : 'other', requestedOn: o.requestedOn, salesforceCase: o.salesforceCase, createdBy: o.createdBy });
  if (o.batchId) await q.query(`UPDATE import_batch SET job_id=$2 WHERE id=$1 AND job_id IS NULL`, [o.batchId, id]);
  return id;
}

// ---------- reading a job ----------

export interface TimelineItem { on: string; what: string; detail?: string; href?: string }
export interface JobDetail {
  id: string; number: number; propertyId: string; property: string; classId: string;
  title: string; source: JobSource; requestedOn: string; requestedBy: string | null; requestNotes: string | null;
  salesforceCase: string | null; salesforceStatus: string | null; closedOn: string | null; closeReason: string | null;
  stage: JobStage; since: string;
  audits: { id: string; on: string; filename: string | null; ended: string | null }[];
  documents: { id: string; type: string; number: string; title: string | null; issued: boolean; createdOn: string; quoted: number }[];
  visits: { id: string; visitedOn: string; outcome: string; notesStatus: string; units: number; invoiced: boolean; invoiceRef: string | null }[];
  outcomes: Record<AarOutcome, number>;
  idUpdates: { pending: number; exported: number; confirmed: number };
  units: { endpointId: string; label: string; outcome: AarOutcome; visitId: string }[];
  money: { quoted: number; invoiced: number; difference: number };
  timeline: TimelineItem[];
}

export async function jobDetail(db: Db, id: string): Promise<JobDetail | null> {
  const j = await one<{ id: string; number: number; property_id: string; name: string; class_id: string; title: string; source: JobSource; requested_on: string; requested_by: string | null;
    request_notes: string | null; salesforce_case: string | null; salesforce_status: string | null; closed_on: string | null; close_reason: string | null }>(db,
    `SELECT j.id, j.number, j.property_id, p.name, p.class_id, j.title, j.source, j.requested_on::text, j.requested_by, j.request_notes, j.salesforce_case, j.salesforce_status,
            j.closed_on::text, j.close_reason FROM job j JOIN property p ON p.id=j.property_id WHERE j.id=$1`, [id]);
  if (!j) return null;
  const tl: TimelineItem[] = [{ on: j.requested_on, what: 'Requested', detail: [SOURCE_LABEL[j.source], j.requested_by, j.request_notes].filter(Boolean).join(' · ') }];

  const audits = (await db.query<{ id: string; on: string; filename: string | null; ended: string | null }>(
    `SELECT b.id, b.imported_at::date::text "on", b.filename,
            (SELECT max(GREATEST(r.read_date_1, r.read_date_2))::text FROM audit_reading r WHERE r.import_batch_id=b.id) ended
       FROM import_batch b WHERE b.job_id=$1 ORDER BY b.imported_at`, [id])).rows;
  for (const a of audits) tl.push({ on: a.on, what: 'Audit imported', detail: [a.ended ? `period ending ${a.ended.slice(5, 7)}/${a.ended.slice(8, 10)}/${a.ended.slice(0, 4)}` : null, a.filename].filter(Boolean).join(' · ') || undefined, href: `/properties/${j.property_id}/audits/${a.id}` });

  const docs = (await db.query<{ id: string; type: string; number: string; title: string | null; created_on: string; issued_on: string | null; version_id: string }>(
    `SELECT d.id, d.type, d.number, d.title, d.created_on::text,
            (SELECT min(v.issued_at)::date::text FROM document_version v WHERE v.document_id=d.id AND v.status='issued') issued_on,
            COALESCE((SELECT v.id FROM document_version v WHERE v.document_id=d.id AND v.status='issued' ORDER BY v.version DESC LIMIT 1),
                     (SELECT v.id FROM document_version v WHERE v.document_id=d.id ORDER BY v.version DESC LIMIT 1)) version_id
       FROM document d WHERE d.job_id=$1 ORDER BY d.created_on, d.created_at`, [id])).rows;
  const documents: JobDetail['documents'] = [];
  for (const d of docs) {
    const lines = (await db.query<{ quantity: string; unit_price: string | null; labor_price: string | null; labor_covered: boolean; part_covered: boolean; include: boolean }>(
      `SELECT quantity::text, unit_price::text, labor_price::text, labor_covered, part_covered, include FROM document_line WHERE version_id=$1`, [d.version_id])).rows;
    const quoted = d.type === 'RFM' ? 0 : lines.reduce((s, l) => s + lineTotal({ building: null, unit: null, address: null, service: null, issueCode: null, description: '', component: null,
      quantity: Number(l.quantity), unitPrice: l.unit_price === null ? null : Number(l.unit_price), laborPrice: l.labor_price === null ? null : Number(l.labor_price),
      laborCovered: l.labor_covered, partCovered: l.part_covered, include: l.include }), 0);
    documents.push({ id: d.id, type: d.type, number: d.number, title: d.title, issued: !!d.issued_on, createdOn: d.created_on, quoted: Math.round(quoted * 100) / 100 });
    tl.push({ on: d.created_on, what: `${d.type} drafted`, detail: d.number, href: `/documents/${d.id}` });
    if (d.issued_on) tl.push({ on: d.issued_on, what: `${d.type} issued`, detail: d.number, href: `/documents/${d.id}` });
  }

  const vs = (await db.query<{ id: string; visited_on: string; outcome: string; notes_status: string; approved_on: string | null; units: string }>(
    `SELECT v.id, v.visited_on::text, v.outcome, v.notes_status, v.approved_at::date::text approved_on,
            (SELECT count(*) FROM service_event se WHERE se.visit_id=v.id AND NOT se.voided AND NOT EXISTS (SELECT 1 FROM service_event x WHERE x.supersedes=se.id)) units
       FROM visit v WHERE v.job_id=$1 ORDER BY v.visited_on, v.created_at`, [id])).rows;
  const visits: JobDetail['visits'] = [];
  const outcomes: Record<AarOutcome, number> = { fixed: 0, still_failing: 0, new_problem: 0, revisit: 0, awaiting_audit: 0 };
  const units = new Map<string, JobDetail['units'][number]>();
  let invoicedTotal = 0; let uninvoiced = false; let draftNotes = false; let missingRef = false;
  for (const v of vs) {
    const inv = (await db.query<{ submitted_on: string; ref: string | null; amount: string | null; open: string }>(
      `SELECT min(s.submitted_on)::text submitted_on, string_agg(DISTINCT s.external_ref, ', ') ref,
              sum(CASE WHEN il.billable THEN il.amount * 1 ELSE 0 END)::text amount,
              (SELECT count(*) FROM service_event se WHERE se.visit_id=$1 AND NOT se.voided AND NOT EXISTS (SELECT 1 FROM service_event x WHERE x.supersedes=se.id)
                  AND NOT EXISTS (SELECT 1 FROM invoice_line l2 WHERE l2.service_event_id=se.id))::text open
         FROM invoice_line il JOIN invoice_submission s ON s.id=il.submission_id JOIN service_event se ON se.id=il.service_event_id WHERE se.visit_id=$1`, [v.id])).rows[0];
    const invoiced = !!inv?.submitted_on;
    invoicedTotal += Number(inv?.amount ?? 0);
    if (Number(v.units) > 0 && v.notes_status !== 'approved') draftNotes = true;
    if (v.notes_status === 'approved' && Number(v.units) > 0 && (!invoiced || Number(inv?.open ?? 0) > 0)) uninvoiced = true;
    if (invoiced && !inv?.ref) missingRef = true;
    visits.push({ id: v.id, visitedOn: v.visited_on, outcome: v.outcome, notesStatus: v.notes_status, units: Number(v.units), invoiced, invoiceRef: inv?.ref ?? null });
    tl.push({ on: v.visited_on, what: 'Service visit', detail: `${v.units} unit(s), ${v.outcome.replaceAll('_', ' ')}`, href: `/visits/${v.id}` });
    if (v.approved_on) tl.push({ on: v.approved_on, what: 'Client notes approved', href: `/visits/${v.id}` });
    if (invoiced) tl.push({ on: inv!.submitted_on, what: 'Sent for invoicing', detail: inv!.ref ? `Invoice ${inv!.ref}` : 'No invoice number yet', href: `/visits/${v.id}` });
    if (Number(v.units) > 0) {
      for (const r of (await aarForVisit(db, v.id)).rows) {
        units.set(r.endpointId, { endpointId: r.endpointId, label: `${r.building}-${r.unit} ${r.service}`, outcome: r.outcome, visitId: v.id });   // later visits win
      }
    }
  }
  for (const u of units.values()) outcomes[u.outcome]++;

  const ids = (await db.query<{ status: string; n: string; first_export: string | null; last_confirm: string | null }>(
    `SELECT i.status, count(*) n, min(i.exported_at)::date::text first_export, max(i.confirmed_at)::date::text last_confirm
       FROM id_update i JOIN visit v ON v.id=i.visit_id WHERE v.job_id=$1 GROUP BY i.status`, [id])).rows;
  const idUpdates = { pending: 0, exported: 0, confirmed: 0 };
  for (const r of ids) {
    idUpdates[r.status as keyof typeof idUpdates] = Number(r.n);
    if (r.status !== 'pending' && r.first_export) tl.push({ on: r.first_export, what: 'ID update sent to billing' });
    if (r.status === 'confirmed' && r.last_confirm) tl.push({ on: r.last_confirm, what: 'ID update confirmed by import' });
  }
  if (j.closed_on) tl.push({ on: j.closed_on, what: 'Closed', detail: j.close_reason ?? undefined });
  tl.sort((a, b) => a.on.localeCompare(b.on));

  let stage: JobStage;
  if (j.closed_on) stage = 'closed';
  else if (!visits.length) stage = documents.some((d) => d.issued) ? 'quoted' : documents.length ? 'drafting' : audits.length ? 'audited' : 'requested';
  else if (draftNotes) stage = 'serviced';
  else if (uninvoiced) stage = 'to_invoice';
  else if (outcomes.still_failing + outcomes.new_problem + outcomes.revisit > 0) stage = 'follow_up';
  else if (outcomes.awaiting_audit > 0 || idUpdates.pending + idUpdates.exported > 0 || missingRef) stage = 'verifying';
  else stage = 'ready';

  const quotedTotal = documents.reduce((s, d) => s + d.quoted, 0);
  return {
    id: j.id, number: j.number, propertyId: j.property_id, property: j.name, classId: j.class_id,
    title: j.title, source: j.source, requestedOn: j.requested_on, requestedBy: j.requested_by, requestNotes: j.request_notes,
    salesforceCase: j.salesforce_case, salesforceStatus: j.salesforce_status, closedOn: j.closed_on, closeReason: j.close_reason,
    stage, since: tl[tl.length - 1]?.on ?? j.requested_on,
    audits, documents, visits, outcomes, idUpdates, units: [...units.values()],
    money: { quoted: Math.round(quotedTotal * 100) / 100, invoiced: Math.round(invoicedTotal * 100) / 100, difference: Math.round((invoicedTotal - quotedTotal) * 100) / 100 },
    timeline: tl,
  };
}

export async function listJobs(db: Db, o: { propertyId?: string; includeClosed?: boolean } = {}): Promise<JobDetail[]> {
  const args: unknown[] = []; const cond: string[] = [];
  if (o.propertyId) { args.push(o.propertyId); cond.push(`property_id=$${args.length}`); }
  if (!o.includeClosed) cond.push('closed_on IS NULL');
  const ids = (await db.query<{ id: string }>(`SELECT id FROM job ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY requested_on DESC, number DESC`, args)).rows;
  const out: JobDetail[] = [];
  for (const r of ids) { const d = await jobDetail(db, r.id); if (d) out.push(d); }
  return out;
}

/** Open jobs at a property, for "which job is this for?" pickers. */
export async function openJobs(q: Q, propertyId: string) {
  return (await q.query<{ id: string; number: number; title: string; requested_on: string }>(
    `SELECT id, number, title, requested_on::text FROM job WHERE property_id=$1 AND closed_on IS NULL ORDER BY requested_on DESC, number DESC`, [propertyId])).rows;
}
