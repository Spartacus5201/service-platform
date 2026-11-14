'use server';
import { can } from '@/src/auth/auth';
import { isOwnVisit } from '@/src/jobs/own';
import { ACTIONS, OUTCOMES, RESULTS, PART_KINDS } from '@/src/service/record';

import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { today } from '@/src/server/dates';
import { requireCan, requireCanOwn } from '@/src/server/session';
import { recordVisit, type Action, type Outcome, type PartKind } from '@/src/service/record';
import { submitInvoice, InvoiceError } from '@/src/billing/invoice';
import { addPhoto, approveCloseout, saveClientText, sendInvoiceSheet, CloseoutError } from '@/src/service/closeout';
import type { Result } from '@/src/service/record';
import { applyCorrections, type CorrectionOp } from '@/src/service/correct';
import { closeoutData } from '@/src/service/closeout';
import { buildIdUpdate, markExported, saveIdOverrides } from '@/src/service/idupdate';
import type { FormState } from '../types';
import { withError, withMsg } from '../ui';
import { s, oneOf, n, msgOf, isRedirect, domainError } from './form';

// ---------- service ----------
export async function recordVisitAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireCanOwn('visit.record');
  const endpointId = s(fd, 'endpoint_id')!; const propertyId = s(fd, 'property_id')!;
  const action = oneOf(fd, 'action', ACTIONS) ?? 'inspect_test';
  const replKind = oneOf(fd, 'repl_kind', PART_KINDS);
  try {
    await recordVisit(await getDb(), {
      // Someone who may record only their own visits is the technician on it.
      ...(can(sess, 'visit.record') ? { technician: s(fd, 'technician') } : { technician: s(fd, 'technician') ?? sess.name, technicianId: sess.userId }),
      propertyId, visitedOn: s(fd, 'visited_on') ?? today(), outcome: oneOf(fd, 'outcome', OUTCOMES) ?? 'completed',
      salesforceCase: s(fd, 'salesforce_case'), salesforceWorkOrder: s(fd, 'salesforce_work_order'), notes: s(fd, 'visit_notes'), createdBy: sess.userId,
      events: [{
        endpointId, action, issueCode: s(fd, 'issue_code'), readAtService: n(fd, 'read_at_service'), notes: s(fd, 'notes'),
        replacements: action === 'replace' && replKind ? [{ kind: replKind, newHardwareId: s(fd, 'new_hardware_id'), newSerial: s(fd, 'new_serial'), model: s(fd, 'model'), catalogItemId: s(fd, 'catalog_item_id') }] : undefined,
      }],
    });
  } catch (e) { if (domainError(e)) return { error: msgOf(e) }; console.error(e); return { error: 'Could not save the visit.' }; }
  redirect(withMsg(`/endpoints/${endpointId}`, 'Visit recorded.'));
}


// ---------- invoicing ----------
export async function submitInvoiceAction(fd: FormData) {
  const sess = await requireCan('invoice.manage');
  const propertyId = s(fd, 'property_id')!;
  const items = fd.getAll('event').map(String).map((id) => ({
    eventId: id, laborAmount: n(fd, `labor_${id}`) ?? 0,
    partAmounts: Object.fromEntries(fd.getAll(`parts_${id}`).map(String).map((pid) => [pid, n(fd, `part_${pid}`) ?? 0])),
    overrideCovered: fd.get(`override_${id}`) === 'on', overrideReason: s(fd, `reason_${id}`) ?? undefined,
  }));
  try {
    const r = await submitInvoice(await getDb(), { propertyId, submittedOn: today(), submittedBy: sess.userId, externalRef: s(fd, 'external_ref'), items });
    redirect(withMsg(`/properties/${propertyId}/invoicing`, `Recorded ${r.lines} line(s): ${r.billable} billable, ${r.notBillable} not billable.`));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError(`/properties/${propertyId}/invoicing`, msgOf(e))); throw e; }
}


// ---------- service notes close-out ----------
export async function createCloseoutAction(fd: FormData) {
  const sess = await requireCan('visit.record');
  const propertyId = s(fd, 'property_id')!;
  const back = `/properties/${propertyId}/closeout/new`;
  const rows = fd.getAll('row').map(String);
  const events = rows.filter((i) => fd.get(`include_${i}`) === 'on').map((i) => {
    const action = oneOf(fd, `action_${i}`, ACTIONS) ?? 'inspect_test';
    const kind = oneOf(fd, `kind_${i}`, PART_KINDS);
    return { endpointId: s(fd, `endpoint_${i}`)!, action, issueCode: s(fd, `issue_${i}`), result: oneOf(fd, `result_${i}`, RESULTS) ?? undefined,
      readAtService: n(fd, `start_${i}`), endRead: n(fd, `end_${i}`), notes: s(fd, `notes_${i}`),
      replacements: action === 'replace' && kind ? [{ kind, newHardwareId: s(fd, `newtx_${i}`) }] : undefined };
  });
  let visitId: string;
  try {
    visitId = (await recordVisit(await getDb(), { propertyId, visitedOn: s(fd, 'visited_on') ?? today(), technician: s(fd, 'technician'), outcome: oneOf(fd, 'outcome', OUTCOMES) ?? 'completed',
      salesforceCase: s(fd, 'salesforce_case'), salesforceWorkOrder: s(fd, 'salesforce_work_order'), notes: s(fd, 'visit_notes'), createdBy: sess.userId, documentId: s(fd, 'document_id'), jobId: s(fd, 'job_id'), events })).visitId;
  } catch (e) { if (domainError(e)) redirect(withError(back, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${visitId}`, 'Visit recorded. Review the wording for the client.'));
}

export async function saveCloseoutAction(fd: FormData) {
  const sess = await requireCan('visit.record');
  const id = s(fd, 'visit_id')!;
  const edits = fd.getAll('event').map(String).map((e) => ({ eventId: e, clientComment: s(fd, `comment_${e}`), extraComment: s(fd, `extra_${e}`) }));
  try { await saveClientText(await getDb(), id, edits, s(fd, 'summary'), sess.userId); } catch (e) { if (domainError(e)) redirect(withError(`/visits/${id}`, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${id}`, 'Saved. Approve when the wording is final.'));
}

export async function approveCloseoutAction(fd: FormData) {
  const sess = await requireCan('notes.approve');
  const id = s(fd, 'visit_id')!;
  try { const db = await getDb(); await approveCloseout(db, id, sess.userId); await buildIdUpdate(db, id); } catch (e) { if (domainError(e)) redirect(withError(`/visits/${id}`, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${id}`, 'Client notes approved.'));
}

export async function addPhotoAction(fd: FormData) {
  const sess = await requireCanOwn('visit.record');
  const id = s(fd, 'visit_id')!; const f = fd.get('photo');
  if (!can(sess, 'visit.record') && !(await isOwnVisit(await getDb(), id, sess.userId))) redirect(withError(`/visits/${id}`, 'You can add photos to your own visits only.'));
  if (!(f instanceof File) || f.size === 0) redirect(withError(`/visits/${id}`, 'Choose a photo first.'));
  try {
    await addPhoto(await getDb(), id, { endpointId: s(fd, 'endpoint_id'), filename: (f as File).name, mime: (f as File).type, bytes: new Uint8Array(await (f as File).arrayBuffer()), caption: s(fd, 'caption'), includeInClient: fd.get('include') === 'on' });
  } catch (e) { if (domainError(e)) redirect(withError(`/visits/${id}`, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${id}`, 'Photo added. Approve again to finalize.'));
}

export async function sendInvoiceSheetAction(fd: FormData) {
  const sess = await requireCan('invoice.manage');
  const id = s(fd, 'visit_id')!;
  try { await sendInvoiceSheet(await getDb(), id, sess.userId, today(), s(fd, 'external_ref')); } catch (e) { if (domainError(e) || e instanceof InvoiceError) redirect(withError(`/visits/${id}`, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${id}`, 'Recorded as sent to admin.'));
}

export async function recordInvoiceRefAction(fd: FormData) {
  const sess = await requireCan('invoice.manage');
  const id = s(fd, 'visit_id')!; const ref = s(fd, 'external_ref');
  if (!ref) redirect(withError(`/visits/${id}`, 'Enter the invoice number.'));
  const db = await getDb();
  await db.query(`UPDATE invoice_submission s SET external_ref=$2 WHERE EXISTS (SELECT 1 FROM invoice_line il JOIN service_event se ON se.id=il.service_event_id WHERE il.submission_id=s.id AND se.visit_id=$1) AND COALESCE(trim(s.external_ref),'')=''`, [id, ref]);
  await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'invoice_ref_recorded','visit',$2,$3)`, [sess.userId, id, JSON.stringify({ visit_id: id, ref })]);
  redirect(withMsg(`/visits/${id}`, 'Invoice number recorded.'));
}


// ---------- corrections ----------
export async function correctVisitAction(fd: FormData) {
  const sess = await requireCan('service.correct');
  const id = s(fd, 'visit_id')!; const back = `/visits/${id}/correct`;
  const reason = s(fd, 'reason');
  const db = await getDb();
  try {
    if (!reason) throw new CloseoutError('Say why the change is needed.');
    const c = await closeoutData(db, id);
    const v = c.visit;
    const vp = { visitedOn: s(fd, 'visited_on') ?? v.visitedOn, technician: s(fd, 'technician'), outcome: oneOf(fd, 'outcome', OUTCOMES) ?? v.outcome,
      salesforceCase: s(fd, 'salesforce_case'), salesforceWorkOrder: s(fd, 'salesforce_work_order'), notes: s(fd, 'visit_notes'), documentId: s(fd, 'document_id') };
    const ops: CorrectionOp[] = [];
    if (vp.visitedOn !== v.visitedOn || vp.technician !== v.technician || vp.outcome !== v.outcome || vp.salesforceCase !== v.salesforceCase || vp.salesforceWorkOrder !== v.salesforceWorkOrder || vp.notes !== v.notes || vp.documentId !== v.documentId)
      ops.push({ kind: 'visit', patch: vp });
    const locked = new Set((await db.query<{ service_event_id: string }>(`SELECT il.service_event_id FROM invoice_line il JOIN service_event se ON se.id=il.service_event_id WHERE se.visit_id=$1`, [id])).rows.map((r) => r.service_event_id));
    for (const u of c.units) {
      const e = u.eventId; const label = `${u.building}-${u.unit}`;
      if (locked.has(e)) continue;                      // invoiced units are shown read-only
      if (fd.get(`void_${e}`) === 'on') { ops.push({ kind: 'void', eventId: e, label }); continue; }
      if (u.action === 'replace') {
        const tx = s(fd, `newtx_${e}`);
        if (tx && tx !== u.newTxId) ops.push({ kind: 'partId', eventId: e, newHardwareId: tx, label });
        continue;
      }
      const patch = { action: (oneOf(fd, `action_${e}`, ACTIONS.filter((a) => a !== 'replace')) ?? u.action) as Exclude<Action, 'replace'>, issueCode: s(fd, `issue_${e}`), result: oneOf(fd, `result_${e}`, RESULTS),
        readAtService: n(fd, `start_${e}`), endRead: n(fd, `end_${e}`), notes: s(fd, `notes_${e}`) };
      const same = patch.action === u.action && patch.issueCode === u.issueCode && (patch.result ?? u.result) === u.result && patch.readAtService === u.startRead && patch.endRead === u.endRead && patch.notes === u.techNotes;
      if (!same) ops.push({ kind: 'event', eventId: e, patch, label });
    }
    if (!ops.length) redirect(withError(back, 'Nothing was changed.'));
    const { done, review } = await applyCorrections(db, id, ops, reason, sess.userId);
    if (review) redirect(withMsg(`/visits/${id}`, `Corrected: ${done.join(', ')}. Client notes need approving again. ${review} later invoiced entr${review === 1 ? 'y' : 'ies'} would now have different warranty coverage: check ${review === 1 ? 'it' : 'them'} (see the activity log).`));
    redirect(withMsg(`/visits/${id}`, `Corrected: ${done.join(', ')}. Client notes need approving again.`));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError(back, msgOf(e))); throw e; }
}


// ---------- ID update ----------
export async function saveIdUpdateAction(fd: FormData) {
  await requireCan('idupdate.manage');
  const id = s(fd, 'visit_id')!;
  const edits = fd.getAll('row').map(String).map((r) => ({ id: r, newMiuid: s(fd, `miuid_${r}`), newPort: s(fd, `port_${r}`) ?? '0', newNet: s(fd, `net_${r}`) ?? '0', systemType: s(fd, `system_${r}`), meterType: s(fd, `meter_${r}`) }));
  try { await saveIdOverrides(await getDb(), id, edits); } catch (e) { if (domainError(e)) redirect(withError(`/visits/${id}/ids`, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${id}/ids`, 'Saved.'));
}

export async function markIdUpdateSentAction(fd: FormData) {
  await requireCan('idupdate.manage');
  const id = s(fd, 'visit_id')!;
  const n = await markExported(await getDb(), id);
  redirect(withMsg(`/visits/${id}/ids`, n ? `${n} unit${n === 1 ? '' : 's'} marked as sent to billing.` : 'Nothing to mark.'));
}
