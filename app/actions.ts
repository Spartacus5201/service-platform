'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/src/server/db';
import { today } from '@/src/server/dates';
import { endSession, requireCan, requireSession, startSession } from '@/src/server/session';
import { authenticate, changePassword, can } from '@/src/auth/auth';
import { parseFile, ParseError } from '@/src/parsers';
import { importParsed, purgeExpiredImports, ImportError } from '@/src/import/commit';
import { addLine, createDocument, issueVersion, newVersion, reconfirmPricing, updateLine, DocumentError } from '@/src/documents/build';
import { recordVisit, ServiceError, type Action, type Outcome, type PartKind } from '@/src/service/record';
import { submitInvoice, InvoiceError } from '@/src/billing/invoice';
import { auditLines } from '@/src/queries/audit';
import { AdminError, addUser, resetPassword, setRole, setActive, saveSettings } from '@/src/admin/admin';
import { setOverride, clearOverride, ReviewError, type OverrideInput } from '@/src/review/overrides';
import { importInventory } from '@/src/catalog/import';
import { getPropertyPrices, parseEquipment, saveSystemNotes, type SystemNotes } from '@/src/documents/systemnotes';
import { addPhoto, approveCloseout, saveClientText, sendInvoiceSheet, CloseoutError } from '@/src/service/closeout';
import type { Result } from '@/src/service/record';
import { correctEventWithReason, correctPartId, correctVisit, voidEvent } from '@/src/service/correct';
import { closeoutData } from '@/src/service/closeout';
import { buildIdUpdate, markExported, saveIdOverrides } from '@/src/service/idupdate';
import { addUnitForIssue, dismissIssue, IssueError } from '@/src/import/issues';
import { createJob, updateJob, closeJob, reopenJob, attachAudit, JobError, type JobSource } from '@/src/jobs/jobs';
import type { CatalogImportUi, FormState, ImportUi, SecretState } from './types';
import { withError, withMsg } from './ui';
import { createUser } from '@/src/auth/auth';

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() !== '' ? v.trim() : null; };
const n = (fd: FormData, k: string): number | null => { const v = s(fd, k); if (v === null) return null; const x = Number(v.replace(/[$,]/g, '')); return Number.isFinite(x) ? x : null; };
const msgOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const isRedirect = (e: unknown) => typeof e === 'object' && e !== null && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT');
const domainError = (e: unknown) => e instanceof ServiceError || e instanceof DocumentError || e instanceof InvoiceError || e instanceof ImportError || e instanceof ParseError || e instanceof ReviewError || e instanceof AdminError || e instanceof CloseoutError || e instanceof JobError;

// ---------- account ----------
export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await authenticate(await getDb(), s(fd, 'email') ?? '', String(fd.get('password') ?? ''));
  if (!sess) return { error: 'Email or password is incorrect.' };
  await startSession(sess.userId);
  redirect('/');
}

export async function firstAdminAction(fd: FormData) {
  const db = await getDb();
  if (Number((await db.query<{ n: string }>(`SELECT count(*) n FROM app_user`)).rows[0].n) > 0) redirect('/login');
  const password = String(fd.get('password') ?? '');
  if (password !== String(fd.get('again') ?? '')) redirect(withError('/setup', 'The passwords do not match.'));
  let id: string;
  try { id = await createUser(db, { email: s(fd, 'email') ?? '', name: s(fd, 'name') ?? 'Administrator', role: 'admin', password, mustChangePassword: false }); }
  catch (e) { redirect(withError('/setup', msgOf(e))); }
  await startSession(id);
  redirect(withMsg('/', 'Administrator created. Add your team under Admin.'));
}

export async function logout() { await endSession(); redirect('/login'); }

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireSession({ allowPasswordChange: true });
  const next = String(fd.get('next') ?? '');
  if (next !== String(fd.get('again') ?? '')) return { error: 'The new passwords do not match.' };
  try {
    const ok = await changePassword(await getDb(), sess.userId, String(fd.get('current') ?? ''), next);
    if (!ok) return { error: 'The current password is not correct.' };
  } catch (e) { return { error: msgOf(e) }; }
  redirect(withMsg('/', 'Password changed.'));
}

// ---------- properties ----------
export async function createProperty(fd: FormData) {
  await requireCan('import_reports');
  const classId = s(fd, 'class_id'); const name = s(fd, 'name');
  if (!classId || !name) redirect(withError('/', 'ClassID and name are required.'));
  const db = await getDb();
  const dup = await db.query(`SELECT 1 FROM property WHERE class_id=$1`, [classId]);
  if (dup.rows.length) redirect(withError('/', `ClassID ${classId} already exists.`));
  const r = await db.query<{ id: string }>(`INSERT INTO property (class_id,name,address,installed_by_us) VALUES ($1,$2,$3,$4) RETURNING id`, [classId, name, s(fd, 'address'), fd.get('installed_by_us') === 'on']);
  redirect(`/properties/${r.rows[0].id}`);
}

export async function saveSystemNotesAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const id = s(fd, 'id')!; const db = await getDb();
  const utilities = [1, 2, 3].map((i) => ({ utility: s(fd, `utility_${i}`) ?? '', device: s(fd, `device_${i}`) ?? '' })).filter((u) => u.utility || u.device);
  const kind = s(fd, 'milestone_kind');
  const notes: SystemNotes = {
    utilities, systemBrand: s(fd, 'system_brand'), systemId: s(fd, 'system_id'), collectorLocation: s(fd, 'collector_location'),
    milestoneKind: kind === 'Install Complete' || kind === 'Takeover' || kind === 'Upgraded' ? kind : null, milestoneOn: s(fd, 'milestone_on'),
    techNote: s(fd, 'tech_note'), transmitterDevice: s(fd, 'transmitter_device'), meterDevice: s(fd, 'meter_device'), equipment: parseEquipment(s(fd, 'equipment') ?? ''),
  };
  // Price editors set property prices; anyone else saves the notes and leaves the prices as they were.
  const prices: Record<string, number> = can(sess.role, 'edit_prices') ? {} : await getPropertyPrices(db, id);
  if (can(sess.role, 'edit_prices')) for (const i of [1, 2, 3, 4, 5]) { const item = s(fd, `price_item_${i}`); const v = n(fd, `price_${i}`); if (item && v !== null) prices[item] = v; }
  try { await saveSystemNotes(db, id, notes, prices, fd.get('msa') === 'on', sess.userId); }
  catch (e) { redirect(withError(`/properties/${id}?tab=settings`, e instanceof Error ? e.message : 'Could not save WA Notes.')); }
  revalidatePath(`/properties/${id}`);
  redirect(withMsg(`/properties/${id}?tab=settings`, 'WA Notes saved.'));
}

export async function updateProperty(fd: FormData) {
  await requireCan('import_reports');
  const id = s(fd, 'id')!;
  await (await getDb()).query(
    `UPDATE property SET name=$2, address=$3, billing_code=$4, installed_by_us=$5, install_completed_on=$6, salesforce_account_ref=$7, access_notes=$8, scheduling_notes=$9, billing_contract=$10, city=$11, state=$12, zip=$13 WHERE id=$1`,
    [id, s(fd, 'name'), s(fd, 'address'), s(fd, 'billing_code'), fd.get('installed_by_us') === 'on', s(fd, 'install_completed_on'), s(fd, 'salesforce_account_ref'), s(fd, 'access_notes'), s(fd, 'scheduling_notes'), fd.get('billing_contract') === 'on', s(fd, 'city'), s(fd, 'state'), s(fd, 'zip')]);
  redirect(withMsg(`/properties/${id}?tab=settings`, 'Property saved.'));
}

// ---------- imports ----------
export async function importReport(_: ImportUi, fd: FormData): Promise<ImportUi> {
  const sess = await requireCan('import_reports');
  const propertyId = s(fd, 'property_id')!;
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose an .xlsx report or a Unit Directory .csv to import.' };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseFile(bytes);
    const asOccupancy = fd.get('purpose') === 'occupancy';
    await purgeExpiredImports(await getDb());     // retention is enforced whenever someone imports
    const r = await importParsed(await getDb(), propertyId, parsed, {
      createMissing: fd.get('create_missing') === 'on', as: asOccupancy ? 'occupancy' : undefined,
      importedBy: sess.userId, filename: file.name, fileBytes: bytes,
    });
    const isAudit = r.kind === 'auto_audit' || r.kind === 'manual_audit';
    return {
      kind: r.kind, duplicate: r.duplicate, rows: 'rows' in parsed ? parsed.rows.length : 'devices' in parsed ? parsed.devices.length : undefined,
      readings: r.readings, devices: r.devices, checkins: r.checkins, unitsCreated: r.unitsCreated, occupancyUpdated: r.occupancyUpdated,
      unmatched: r.unmatched, idChanges: r.idChanges, warnings: r.warnings.slice(0, 20),
      auditUrl: isAudit && r.batchId && !r.duplicate ? `/properties/${propertyId}/audits/${r.batchId}` : undefined,
    };
  } catch (e) {
    if (domainError(e)) return { error: msgOf(e) };
    console.error(e);
    return { error: 'That file could not be read. Check that it is an unmodified system report.' };
  }
}

// ---------- documents ----------
export async function createDocumentAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const propertyId = s(fd, 'property_id')!; const batchId = s(fd, 'batch_id');
  const type = s(fd, 'type') as 'WA' | 'Proposal' | 'RFM';
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
    for (const id of fd.getAll('line').map(String)) {
      const patch: Record<string, unknown> = {
        description: s(fd, `desc_${id}`) ?? '', quantity: n(fd, `qty_${id}`) ?? 1,
        include: fd.get(`inc_${id}`) === 'on', laborCovered: fd.get(`labor_${id}`) === 'on', partCovered: fd.get(`part_${id}`) === 'on',
      };
      if (canPrice) { patch.unitPrice = n(fd, `price_${id}`); patch.laborPrice = n(fd, `laborprice_${id}`); }
      await updateLine(db, id, patch);
    }
    const nd = s(fd, 'new_desc');
    if (nd) await addLine(db, s(fd, 'version_id')!, { description: nd, quantity: n(fd, 'new_qty') ?? 1, unitPrice: n(fd, 'new_price'), laborPrice: canPrice ? n(fd, 'new_labor') : null, catalogItemId: s(fd, 'new_item') });
    const title = s(fd, 'title');
    await db.query(`UPDATE document SET title=$2, salesforce_case=$3, salesforce_work_order=$4, charge_code=COALESCE($5, charge_code), addressee=$6, notes=$7, shipping=$8, prepared_by=$9 WHERE id=$1`,
      [docId, title, s(fd, 'salesforce_case'), s(fd, 'salesforce_work_order'), ['20', '21', '23'].includes(s(fd, 'charge_code') ?? '') ? s(fd, 'charge_code') : null,
       s(fd, 'addressee'), s(fd, 'notes'), canPrice ? n(fd, 'shipping') : null, s(fd, 'prepared_by')]);
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

// ---------- service ----------
export async function recordVisitAction(_: FormState, fd: FormData): Promise<FormState> {
  const sess = await requireCan('record_service');
  const endpointId = s(fd, 'endpoint_id')!; const propertyId = s(fd, 'property_id')!;
  const action = (s(fd, 'action') ?? 'inspect_test') as Action;
  const replKind = s(fd, 'repl_kind') as PartKind | null;
  try {
    await recordVisit(await getDb(), {
      propertyId, visitedOn: s(fd, 'visited_on') ?? today(), technician: s(fd, 'technician'), outcome: (s(fd, 'outcome') ?? 'completed') as Outcome,
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
  const sess = await requireCan('edit_prices');
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

// ---------- catalog and clauses ----------
export async function saveCatalogItem(fd: FormData) {
  await requireCan('edit_prices');
  const name = s(fd, 'name'); if (!name) redirect(withError('/catalog', 'A name is required.'));
  await (await getDb()).query(
    `INSERT INTO catalog_item (name,description,kind,component,unit,price,effective_from) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [name, s(fd, 'description'), s(fd, 'kind') ?? 'part', s(fd, 'component'), s(fd, 'unit') ?? 'each', n(fd, 'price'), s(fd, 'effective_from') ?? today()]);
  redirect(withMsg('/catalog', 'Item added. A new row with a later date supersedes the old price.'));
}

export async function importCatalogAction(_: CatalogImportUi, fd: FormData): Promise<CatalogImportUi> {
  const sess = await requireCan('edit_prices');
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose the price list (.xlsx) first.' };
  const apply = s(fd, 'intent') === 'apply';
  try {
    const db = await getDb();
    const r = await importInventory(db, new Uint8Array(await file.arrayBuffer()), today(), apply);
    if (apply) await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'catalog_import','catalog',$2,$3)`,
      [sess.userId, file.name, JSON.stringify({ added: r.added, changed: r.changed, unchanged: r.unchanged })]);
    return {
      applied: apply, summary: { rows: r.rows, added: r.added, changed: r.changed, unchanged: r.unchanged, skippedNoPrice: r.skippedNoPrice, obsolete: r.obsolete },
      changes: r.changes.slice(0, 50).map((c) => ({ name: c.name, from: c.from, to: c.to })), addedSample: r.addedNames.slice(0, 10),
    };
  } catch (e) {
    if (domainError(e)) return { error: msgOf(e) };
    console.error(e); return { error: 'That file could not be read. Save the price list as .xlsx and try again.' };
  }
}

/** Mark one catalog item as the part suggested on new drafts for its component (one per component). */
export async function setSuggestDefaultAction(fd: FormData) {
  await requireCan('edit_prices');
  const id = s(fd, 'id')!; const on = fd.get('on') === '1';
  const db = await getDb();
  await db.transaction(async (tx) => {
    const row = (await tx.query<{ component: string | null; name: string; part_type: string | null; part_number: string | null }>(`SELECT component,name,part_type,part_number FROM catalog_item WHERE id=$1`, [id])).rows[0];
    if (!row?.component) return;
    await tx.query(`UPDATE catalog_item SET suggest_default=false WHERE component=$1`, [row.component]);
    if (on) await tx.query(`UPDATE catalog_item SET suggest_default=true WHERE lower(name)=lower($1) AND coalesce(part_type,'')=coalesce($2,'') AND coalesce(part_number,'')=coalesce($3,'')`, [row.name, row.part_type, row.part_number]);
  });
  redirect(withMsg('/catalog', on ? 'Suggested part set.' : 'Suggestion cleared.'));
}

export async function saveClause(fd: FormData) {
  await requireCan('edit_documents');
  const key = s(fd, 'key'); const title = s(fd, 'title'); const body = s(fd, 'body');
  if (!key || !title || !body) redirect(withError('/clauses', 'Key, title, and text are required.'));
  const types = fd.getAll('types').map(String).filter((t) => ['WA', 'Proposal', 'RFM'].includes(t));
  const audience = s(fd, 'audience');
  const db = await getDb();
  const v = (await db.query<{ v: number | null }>(`SELECT max(version) v FROM clause_template WHERE key=$1`, [key])).rows[0].v ?? 0;
  await db.query(`INSERT INTO clause_template (key,title,body,applies_when,version) VALUES ($1,$2,$3,$4,$5)`,
    [key, title, body, JSON.stringify({ ...(types.length ? { types } : {}), ...(audience ? { audience } : {}) }), v + 1]);
  redirect(withMsg('/clauses', v ? `Clause "${key}" saved as version ${v + 1}.` : 'Clause added.'));
}

// ---------- audit review ----------
export async function overrideAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const propertyId = s(fd, 'property_id')!; const batchId = s(fd, 'batch_id')!; const readingId = s(fd, 'reading_id')!;
  const back = (extra: string) => `/properties/${propertyId}/audits/${batchId}${s(fd, 'show') === 'all' ? '?show=all&' : '?'}${extra}`;
  const db = await getDb();
  try {
    if (s(fd, 'intent') === 'clear') { await clearOverride(db, readingId, sess.userId); redirect(back('msg=' + encodeURIComponent('Back to the rules\' answer.'))); }
    const line = (await auditLines(db, batchId, today())).find((l) => l.readingId === readingId);
    if (!line) throw new ReviewError('That reading is not in this audit.');
    const r = await setOverride(db, readingId, { action: s(fd, 'action') as OverrideInput['action'], owner: s(fd, 'owner'), component: s(fd, 'component'), reason: s(fd, 'reason') ?? '' }, sess.userId, line.rules);
    redirect(back('msg=' + encodeURIComponent(r === 'saved' ? `Saved: ${line.building}-${line.unit} ${line.service}.` : 'That matches the rules, so the correction was removed.')));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(back('error=' + encodeURIComponent(msgOf(e)))); throw e; }
}

// ---------- admin ----------
export async function addUserAction(_: SecretState, fd: FormData): Promise<SecretState> {
  const sess = await requireCan('manage_users');
  try {
    const r = await addUser(await getDb(), sess.userId, { email: s(fd, 'email') ?? '', name: s(fd, 'name') ?? '', role: s(fd, 'role') as never });
    revalidatePath('/admin');
    return { password: r.password, who: s(fd, 'email') ?? '' };
  } catch (e) { if (domainError(e)) return { error: msgOf(e) }; throw e; }
}
export async function resetPasswordAction(_: SecretState, fd: FormData): Promise<SecretState> {
  const sess = await requireCan('manage_users');
  try { revalidatePath('/admin'); return { password: await resetPassword(await getDb(), sess.userId, s(fd, 'user_id')!), who: s(fd, 'who') ?? '' }; }
  catch (e) { if (domainError(e)) return { error: msgOf(e) }; throw e; }
}
export async function userChangeAction(fd: FormData) {
  const sess = await requireCan('manage_users');
  const id = s(fd, 'user_id')!; const db = await getDb();
  try {
    if (s(fd, 'intent') === 'deactivate') await setActive(db, sess.userId, id, false);
    else if (s(fd, 'intent') === 'reactivate') await setActive(db, sess.userId, id, true);
    else await setRole(db, sess.userId, id, s(fd, 'role') as never);
  } catch (e) { if (domainError(e)) redirect(withError('/admin', msgOf(e))); throw e; }
  redirect(withMsg('/admin', 'Saved.'));
}
export async function saveSettingsAction(fd: FormData) {
  const sess = await requireCan('manage_settings');
  const input: Record<string, string> = {}; for (const [k, v] of fd.entries()) if (typeof v === 'string') input[k] = v;
  try {
    const changed = await saveSettings(await getDb(), sess.userId, input);
    redirect(withMsg('/admin', changed.length ? `Saved: ${changed.join(', ')}.` : 'No changes.'));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError('/admin', msgOf(e))); throw e; }
}
export async function purgeNowAction() {
  await requireCan('manage_settings');
  const n = await purgeExpiredImports(await getDb());
  redirect(withMsg('/admin', `${n} expired raw file(s) deleted.`));
}

// ---------- service notes close-out ----------
export async function createCloseoutAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const propertyId = s(fd, 'property_id')!;
  const back = `/properties/${propertyId}/closeout/new`;
  const rows = fd.getAll('row').map(String);
  const events = rows.filter((i) => fd.get(`include_${i}`) === 'on').map((i) => {
    const action = (s(fd, `action_${i}`) ?? 'inspect_test') as Action;
    const kind = s(fd, `kind_${i}`) as PartKind | null;
    return { endpointId: s(fd, `endpoint_${i}`)!, action, issueCode: s(fd, `issue_${i}`), result: (s(fd, `result_${i}`) as Result | null) ?? undefined,
      readAtService: n(fd, `start_${i}`), endRead: n(fd, `end_${i}`), notes: s(fd, `notes_${i}`),
      replacements: action === 'replace' && kind ? [{ kind, newHardwareId: s(fd, `newtx_${i}`) }] : undefined };
  });
  let visitId: string;
  try {
    visitId = (await recordVisit(await getDb(), { propertyId, visitedOn: s(fd, 'visited_on') ?? today(), technician: s(fd, 'technician'), outcome: (s(fd, 'outcome') ?? 'completed') as Outcome,
      salesforceCase: s(fd, 'salesforce_case'), salesforceWorkOrder: s(fd, 'salesforce_work_order'), notes: s(fd, 'visit_notes'), createdBy: sess.userId, documentId: s(fd, 'document_id'), jobId: s(fd, 'job_id'), events })).visitId;
  } catch (e) { if (domainError(e)) redirect(withError(back, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${visitId}`, 'Visit recorded. Review the wording for the client.'));
}

export async function saveCloseoutAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const id = s(fd, 'visit_id')!;
  const edits = fd.getAll('event').map(String).map((e) => ({ eventId: e, clientComment: s(fd, `comment_${e}`), extraComment: s(fd, `extra_${e}`) }));
  try { await saveClientText(await getDb(), id, edits, s(fd, 'summary'), sess.userId); } catch (e) { if (domainError(e)) redirect(withError(`/visits/${id}`, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${id}`, 'Saved. Approve when the wording is final.'));
}

export async function approveCloseoutAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const id = s(fd, 'visit_id')!;
  try { const db = await getDb(); await approveCloseout(db, id, sess.userId); await buildIdUpdate(db, id); } catch (e) { if (domainError(e)) redirect(withError(`/visits/${id}`, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${id}`, 'Client notes approved.'));
}

export async function addPhotoAction(fd: FormData) {
  await requireCan('edit_documents');
  const id = s(fd, 'visit_id')!; const f = fd.get('photo');
  if (!(f instanceof File) || f.size === 0) redirect(withError(`/visits/${id}`, 'Choose a photo first.'));
  try {
    await addPhoto(await getDb(), id, { endpointId: s(fd, 'endpoint_id'), filename: (f as File).name, mime: (f as File).type, bytes: new Uint8Array(await (f as File).arrayBuffer()), caption: s(fd, 'caption'), includeInClient: fd.get('include') === 'on' });
  } catch (e) { if (domainError(e)) redirect(withError(`/visits/${id}`, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${id}`, 'Photo added. Approve again to finalize.'));
}

export async function sendInvoiceSheetAction(fd: FormData) {
  const sess = await requireCan('edit_prices');
  const id = s(fd, 'visit_id')!;
  try { await sendInvoiceSheet(await getDb(), id, sess.userId, today(), s(fd, 'external_ref')); } catch (e) { if (domainError(e) || e instanceof InvoiceError) redirect(withError(`/visits/${id}`, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${id}`, 'Recorded as sent to admin.'));
}

export async function recordInvoiceRefAction(fd: FormData) {
  const sess = await requireCan('edit_prices');
  const id = s(fd, 'visit_id')!; const ref = s(fd, 'external_ref');
  if (!ref) redirect(withError(`/visits/${id}`, 'Enter the invoice number.'));
  const db = await getDb();
  await db.query(`UPDATE invoice_submission s SET external_ref=$2 WHERE EXISTS (SELECT 1 FROM invoice_line il JOIN service_event se ON se.id=il.service_event_id WHERE il.submission_id=s.id AND se.visit_id=$1) AND COALESCE(trim(s.external_ref),'')=''`, [id, ref]);
  await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'invoice_ref_recorded','visit',$2,$3)`, [sess.userId, id, JSON.stringify({ visit_id: id, ref })]);
  redirect(withMsg(`/visits/${id}`, 'Invoice number recorded.'));
}

// ---------- jobs ----------
const jobFields = (fd: FormData) => ({
  title: s(fd, 'title') ?? '', source: (s(fd, 'source') ?? 'other') as JobSource, requestedOn: s(fd, 'requested_on') ?? today(),
  requestedBy: s(fd, 'requested_by'), requestNotes: s(fd, 'request_notes'), salesforceCase: s(fd, 'salesforce_case'), salesforceStatus: s(fd, 'salesforce_status'),
});
export async function createJobAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const propertyId = s(fd, 'property_id')!;
  let id: string;
  try { id = await createJob(await getDb(), { propertyId, ...jobFields(fd), createdBy: sess.userId }); }
  catch (e) { if (e instanceof JobError) redirect(withError(`/properties/${propertyId}?tab=work`, e.message)); throw e; }
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
export async function attachAuditAction(fd: FormData) {
  await requireCan('edit_documents');
  const id = s(fd, 'job_id')!; const batch = s(fd, 'batch_id');
  if (!batch) redirect(withError(`/jobs/${id}`, 'Pick an audit.'));
  try { await attachAudit(await getDb(), id, batch); }
  catch (e) { if (e instanceof JobError) redirect(withError(`/jobs/${id}`, e.message)); throw e; }
  redirect(withMsg(`/jobs/${id}`, 'Audit attached.'));
}

// ---------- import problems ----------
export async function resolveIssueAction(fd: FormData) {
  const sess = await requireCan('import_reports');
  const id = s(fd, 'issue_id')!; const back = s(fd, 'back') ?? '/';
  const db = await getDb();
  try {
    if (fd.get('do') === 'add') await addUnitForIssue(db, id, sess.userId);
    else await dismissIssue(db, id, s(fd, 'reason'), sess.userId);
  } catch (e) { if (e instanceof IssueError) redirect(withError(back, e.message)); throw e; }
  redirect(withMsg(back, fd.get('do') === 'add' ? 'Unit added.' : 'Dismissed.'));
}

// ---------- corrections ----------
export async function correctVisitAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const id = s(fd, 'visit_id')!; const back = `/visits/${id}/correct`;
  const reason = s(fd, 'reason');
  const db = await getDb();
  try {
    if (!reason) throw new CloseoutError('Say why the change is needed.');
    const c = await closeoutData(db, id);
    const v = c.visit; const done: string[] = [];
    const vp = { visitedOn: s(fd, 'visited_on') ?? v.visitedOn, technician: s(fd, 'technician'), outcome: (s(fd, 'outcome') ?? v.outcome) as Outcome,
      salesforceCase: s(fd, 'salesforce_case'), salesforceWorkOrder: s(fd, 'salesforce_work_order'), notes: s(fd, 'visit_notes'), documentId: s(fd, 'document_id') };
    if (vp.visitedOn !== v.visitedOn || vp.technician !== v.technician || vp.outcome !== v.outcome || vp.salesforceCase !== v.salesforceCase || vp.salesforceWorkOrder !== v.salesforceWorkOrder || vp.notes !== v.notes || vp.documentId !== v.documentId) {
      await correctVisit(db, id, vp, reason, sess.userId); done.push('visit details');
    }
    const locked = new Set((await db.query<{ service_event_id: string }>(`SELECT il.service_event_id FROM invoice_line il JOIN service_event se ON se.id=il.service_event_id WHERE se.visit_id=$1`, [id])).rows.map((r) => r.service_event_id));
    for (const u of (await closeoutData(db, id)).units) {
      const e = u.eventId;
      if (locked.has(e)) continue;                      // invoiced units are shown read-only
      if (fd.get(`void_${e}`) === 'on') { await voidEvent(db, e, reason, sess.userId); done.push(`${u.building}-${u.unit} voided`); continue; }
      if (u.action === 'replace') {
        const tx = s(fd, `newtx_${e}`);
        if (tx && tx !== u.newTxId) { await correctPartId(db, e, tx, reason, sess.userId); done.push(`${u.building}-${u.unit} new ID`); }
        continue;
      }
      const patch = { action: (s(fd, `action_${e}`) ?? u.action) as Exclude<Action, 'replace'>, issueCode: s(fd, `issue_${e}`), result: (s(fd, `result_${e}`) as Result | null) ?? null,
        readAtService: n(fd, `start_${e}`), endRead: n(fd, `end_${e}`), notes: s(fd, `notes_${e}`) };
      const same = patch.action === u.action && patch.issueCode === u.issueCode && (patch.result ?? u.result) === u.result && patch.readAtService === u.startRead && patch.endRead === u.endRead && patch.notes === u.techNotes;
      if (!same) { await correctEventWithReason(db, e, patch, reason, sess.userId); done.push(`${u.building}-${u.unit}`); }
    }
    if (!done.length) redirect(withError(back, 'Nothing was changed.'));
    redirect(withMsg(`/visits/${id}`, `Corrected: ${done.join(', ')}. Client notes need approving again.`));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError(back, msgOf(e))); throw e; }
}

// ---------- ID update ----------
export async function saveIdUpdateAction(fd: FormData) {
  await requireCan('edit_documents');
  const id = s(fd, 'visit_id')!;
  const edits = fd.getAll('row').map(String).map((r) => ({ id: r, newMiuid: s(fd, `miuid_${r}`), newPort: s(fd, `port_${r}`) ?? '0', newNet: s(fd, `net_${r}`) ?? '0', systemType: s(fd, `system_${r}`), meterType: s(fd, `meter_${r}`) }));
  try { await saveIdOverrides(await getDb(), id, edits); } catch (e) { if (domainError(e)) redirect(withError(`/visits/${id}/ids`, msgOf(e))); throw e; }
  redirect(withMsg(`/visits/${id}/ids`, 'Saved.'));
}

export async function markIdUpdateSentAction(fd: FormData) {
  await requireCan('edit_documents');
  const id = s(fd, 'visit_id')!;
  const n = await markExported(await getDb(), id);
  redirect(withMsg(`/visits/${id}/ids`, n ? `${n} unit${n === 1 ? '' : 's'} marked as sent to billing.` : 'Nothing to mark.'));
}
