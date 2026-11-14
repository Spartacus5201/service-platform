'use server';
import { DOC_TYPES } from '@/src/documents/build';

import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { today } from '@/src/server/dates';
import { requireCan } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { createDocument, issueVersion, newVersion, reconfirmPricing, saveDraft } from '@/src/documents/build';
import { withError, withMsg } from '../ui';
import { s, oneOf, n, msgOf, isRedirect, domainError } from './form';

// ---------- documents ----------
export async function createDocumentAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const propertyId = s(fd, 'property_id')!; const batchId = s(fd, 'batch_id');
  const type = oneOf(fd, 'type', DOC_TYPES) ?? 'WA';
  try {
    const d = await createDocument(await getDb(), {
      propertyId, type, title: s(fd, 'title') ?? undefined, createdOn: today(), createdBy: sess.userId,
      salesforceCase: s(fd, 'salesforce_case'), salesforceWorkOrder: s(fd, 'salesforce_work_order'),
      fromAuditBatch: batchId ?? undefined, jobId: s(fd, 'job_id'), actsAs: type === 'Proposal' ? (fd.getAll('acts_as').filter((x): x is 'WA' | 'RFM' => x === 'WA' || x === 'RFM')) : undefined,
    });
    redirect(`/documents/${d.documentId}`);
  } catch (e) {
    if (isRedirect(e)) throw e;
    if (domainError(e)) redirect(withError(batchId ? `/properties/${propertyId}/audits/${batchId}` : `/properties/${propertyId}?tab=work`, msgOf(e)));
    throw e;
  }
}

export async function saveLinesAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const docId = s(fd, 'document_id')!;
  const canPrice = can(sess.role, 'edit_prices');
  const db = await getDb();
  try {
    const versionId = s(fd, 'version_id')!;
    const nd = s(fd, 'new_desc');
    await saveDraft(db, docId, versionId, {
      lines: fd.getAll('line').map(String).map((id) => ({ id, patch: {
        description: s(fd, `desc_${id}`) ?? '', quantity: n(fd, `qty_${id}`) ?? 1,
        include: fd.get(`inc_${id}`) === 'on', laborCovered: fd.get(`labor_${id}`) === 'on', partCovered: fd.get(`part_${id}`) === 'on',
        unitPrice: n(fd, `price_${id}`), laborPrice: n(fd, `laborprice_${id}`),
      } })),
      newLine: nd ? { description: nd, quantity: n(fd, 'new_qty') ?? 1, unitPrice: n(fd, 'new_price'), laborPrice: n(fd, 'new_labor'), catalogItemId: s(fd, 'new_item') } : null,
      header: { title: s(fd, 'title'), salesforceCase: s(fd, 'salesforce_case'), salesforceWorkOrder: s(fd, 'salesforce_work_order'), chargeCode: s(fd, 'charge_code'),
        addressee: s(fd, 'addressee'), notes: s(fd, 'notes'), shipping: n(fd, 'shipping'), preparedBy: s(fd, 'prepared_by') },
    }, canPrice);
    if (s(fd, 'intent') === 'issue') {
      const r = await issueVersion(db, s(fd, 'version_id')!, sess.userId, today());
      redirect(withMsg(`/documents/${docId}`, r.missingFields.length ? `Issued, but these merge fields are empty: ${r.missingFields.join(', ')}.` : 'Issued and locked.'));
    }
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError(`/documents/${docId}`, msgOf(e))); throw e; }
  redirect(withMsg(`/documents/${docId}`, 'Draft saved.'));
}

export async function issueAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const docId = s(fd, 'document_id')!;
  try {
    const r = await issueVersion(await getDb(), s(fd, 'version_id')!, sess.userId, today());
    redirect(withMsg(`/documents/${docId}`, r.missingFields.length ? `Issued, but these merge fields are empty: ${r.missingFields.join(', ')}.` : 'Issued and locked.'));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError(`/documents/${docId}`, msgOf(e))); throw e; }
}

export async function newVersionAction(fd: FormData) {
  await requireCan('edit_documents');
  const docId = s(fd, 'document_id')!;
  try { await newVersion(await getDb(), docId); } catch (e) { if (domainError(e)) redirect(withError(`/documents/${docId}`, msgOf(e))); throw e; }
  redirect(withMsg(`/documents/${docId}`, 'New draft version started.'));
}

export async function reconfirmAction(fd: FormData) {
  const sess = await requireCan('edit_prices');
  const docId = s(fd, 'document_id')!;
  try { await reconfirmPricing(await getDb(), docId, sess.userId, today()); } catch (e) { if (domainError(e)) redirect(withError(`/documents/${docId}`, msgOf(e))); throw e; }
  redirect(withMsg(`/documents/${docId}`, 'Pricing reconfirmed.'));
}
