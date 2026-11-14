'use server';
import { JOB_SOURCES } from '@/src/jobs/jobs';

import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { today } from '@/src/server/dates';
import { requireCan } from '@/src/server/session';
import { createJob, updateJob, closeJob, reopenJob, attachAudit, refreshFromSalesforce, JobError, type JobSource } from '@/src/jobs/jobs';
import { salesforce, SalesforceError } from '@/src/salesforce/client';
import { withError, withMsg } from '../ui';
import { s, oneOf, isRedirect } from './form';

// ---------- jobs ----------
const jobFields = (fd: FormData) => ({
  title: s(fd, 'title') ?? '', source: oneOf(fd, 'source', JOB_SOURCES) ?? 'other', requestedOn: s(fd, 'requested_on') ?? today(),
  requestedBy: s(fd, 'requested_by'), requestNotes: s(fd, 'request_notes'), salesforceCase: s(fd, 'salesforce_case'), salesforceStatus: s(fd, 'salesforce_status'),
});
export async function createJobAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const propertyId = s(fd, 'property_id')!;
  let id: string;
  const db = await getDb();
  try { id = await createJob(db, { propertyId, ...jobFields(fd), createdBy: sess.userId }); }
  catch (e) { if (e instanceof JobError) redirect(withError(`/properties/${propertyId}?tab=work`, e.message)); throw e; }
  // Fill the status from Salesforce when a case was given and lookups are on; a failure here is not a reason to lose the job.
  try { const client = salesforce(); if (client && s(fd, 'salesforce_case')) await refreshFromSalesforce(db, id, client); } catch { /* status stays as typed */ }
  redirect(withMsg(`/jobs/${id}`, 'Job created.'));
}
export async function updateJobAction(fd: FormData) {
  await requireCan('edit_documents');
  const id = s(fd, 'job_id')!;
  try { await updateJob(await getDb(), id, jobFields(fd)); }
  catch (e) { if (e instanceof JobError) redirect(withError(`/jobs/${id}`, e.message)); throw e; }
  redirect(withMsg(`/jobs/${id}`, 'Saved.'));
}
export async function closeJobAction(fd: FormData) {
  await requireCan('edit_documents');
  const id = s(fd, 'job_id')!; const db = await getDb();
  if (fd.get('reopen')) { await reopenJob(db, id); redirect(withMsg(`/jobs/${id}`, 'Job reopened.')); }
  try { await closeJob(db, id, today(), s(fd, 'close_reason'), fd.get('early') === '1'); }
  catch (e) { if (e instanceof JobError) redirect(withError(`/jobs/${id}`, e.message)); throw e; }
  redirect(withMsg(`/jobs/${id}`, 'Job closed.'));
}
export async function refreshSalesforceAction(fd: FormData) {
  await requireCan('edit_documents');
  const id = s(fd, 'job_id')!;
  let msg: string;
  try {
    const client = salesforce();
    if (!client) redirect(withError(`/jobs/${id}`, 'Salesforce lookups are off on this server.'));
    const r = await refreshFromSalesforce(await getDb(), id, client);
    msg = `Salesforce: ${r.status}${client.mode === 'mock' ? ' (sample data)' : ''}`;
    if (r.warning) redirect(withError(withMsg(`/jobs/${id}`, msg), r.warning));
  } catch (e) { if (isRedirect(e)) throw e; if (e instanceof JobError || e instanceof SalesforceError) redirect(withError(`/jobs/${id}`, e.message)); throw e; }
  redirect(withMsg(`/jobs/${id}`, msg));
}

export async function attachAuditAction(fd: FormData) {
  await requireCan('edit_documents');
  const id = s(fd, 'job_id')!; const batch = s(fd, 'batch_id');
  if (!batch) redirect(withError(`/jobs/${id}`, 'Pick an audit.'));
  try { await attachAudit(await getDb(), id, batch); }
  catch (e) { if (e instanceof JobError) redirect(withError(`/jobs/${id}`, e.message)); throw e; }
  redirect(withMsg(`/jobs/${id}`, 'Audit attached.'));
}
