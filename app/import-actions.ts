'use server';
import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { ImportError } from '@/src/import/commit';
import { ParseError } from '@/src/parsers/common';
import { WizardError, getUpload, wizardView, chooseTarget, saveState, setColumns, addLookups, setExcluded, setTable, commitWizard, discardUpload, getLayout, retireLayout } from '@/src/importer/wizard';
import type { Target } from '@/src/importer/layout';
import { withError, withMsg } from './ui';

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() !== '' ? v.trim() : null; };
const isRedirect = (e: unknown) => typeof e === 'object' && e !== null && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT');
const known = (e: unknown) => e instanceof WizardError || e instanceof ImportError || e instanceof ParseError;
const page = (pid: string, id: string) => `/properties/${pid}/import/${id}`;

/** Run one wizard step and come back to the wizard page, with the step's message or error. */
async function step(fd: FormData, run: (db: Awaited<ReturnType<typeof getDb>>, id: string) => Promise<string | void>) {
  await requireCan('import_reports');
  const id = s(fd, 'upload_id') ?? ''; const db = await getDb();
  let pid = s(fd, 'property_id') ?? '';
  try {
    pid = (await getUpload(db, id)).propertyId;
    const msg = await run(db, id);
    redirect(msg ? withMsg(page(pid, id), msg) : page(pid, id));
  } catch (e) {
    if (isRedirect(e)) throw e;
    if (!known(e)) console.error(e);
    redirect(withError(pid ? page(pid, id) : '/', known(e) ? (e as Error).message : 'Something went wrong.'));
  }
}

export async function wizTableAction(fd: FormData) {
  await step(fd, (db, id) => setTable(db, id, s(fd, 'sheet') ?? '', Number(s(fd, 'header_row'))));
}

export async function wizTargetAction(fd: FormData) {
  await step(fd, async (db, id) => {
    const choice = s(fd, 'choice') ?? ''; const v = await wizardView(db, id);
    const header = v.columns.map((c) => c.header);
    if (choice.startsWith('layout:')) {
      const layout = await getLayout(db, choice.slice(7)); if (!layout) throw new WizardError('That map no longer exists.');
      await saveState(db, id, chooseTarget(v.state, header, { layout }));
    } else await saveState(db, id, chooseTarget(v.state, header, { target: choice.replace(/^target:/, '') as Target }));
  });
}

export async function wizColumnsAction(fd: FormData) {
  await step(fd, async (db, id) => {
    const choices: Record<string, { column: number | null; constant: string }> = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith('col:')) continue;
      const field = k.slice(4); const raw = String(v);
      choices[field] = { column: raw ? Number(raw) : null, constant: String(fd.get(`const:${field}`) ?? '') };
    }
    await setColumns(db, id, choices);
    return 'Columns saved. Check the preview below.';
  });
}

export async function wizValuesAction(fd: FormData) {
  await step(fd, async (db, id) => {
    const field = s(fd, 'field') ?? ''; const pairs: { raw: string; as: string }[] = [];
    for (const [k, v] of fd.entries()) if (k.startsWith('as:')) pairs.push({ raw: k.slice(3), as: String(v) });
    await addLookups(db, id, field, pairs);
  });
}

export async function wizExcludeAction(fd: FormData) {
  await step(fd, async (db, id) => {
    const rows = fd.getAll('row').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    await setExcluded(db, id, fd.get('intent') === 'clear' ? [] : rows, s(fd, 'reason'));
  });
}

export async function wizImportAction(fd: FormData) {
  const sess = await requireCan('import_reports');
  const id = s(fd, 'upload_id') ?? ''; const db = await getDb();
  let pid = '';
  try {
    pid = (await getUpload(db, id)).propertyId;
    const r = await commitWizard(db, id, { saveAs: s(fd, 'save_as'), createMissing: fd.get('create_missing') === 'on', userId: sess.userId });
    const res = r.result;
    const parts = [res.duplicate ? 'This exact file was already imported; nothing changed.' : `Imported with “${r.layout.name}” (version ${r.layout.version}): ${res.checkins} transmitter(s)${res.occupancyUpdated ? `, ${res.occupancyUpdated} occupancy update(s)` : ''}${res.unitsCreated ? `, ${res.unitsCreated} unit(s) added` : ''}.`];
    if (res.unmatched.length) parts.push(`${res.unmatched.length} unit(s) not on file were skipped (see Import problems).`);
    if (res.idChanges.length) parts.push(`${res.idChanges.length} transmitter ID(s) differ from the record (see Import problems).`);
    redirect(withMsg(`/properties/${pid}`, parts.join(' ')));
  } catch (e) {
    if (isRedirect(e)) throw e;
    if (!known(e)) console.error(e);
    redirect(withError(pid ? page(pid, id) : '/', known(e) ? (e as Error).message : 'Something went wrong.'));
  }
}

export async function wizDiscardAction(fd: FormData) {
  await requireCan('import_reports');
  const db = await getDb(); const id = s(fd, 'upload_id') ?? ''; const pid = s(fd, 'property_id') ?? '';
  await discardUpload(db, id);
  redirect(withMsg(pid ? `/properties/${pid}` : '/', 'File discarded. Nothing was imported.'));
}

export async function retireLayoutAction(fd: FormData) {
  const sess = await requireCan('manage_users');
  try { await retireLayout(await getDb(), s(fd, 'id') ?? '', sess.userId); }
  catch (e) { if (e instanceof WizardError) redirect(withError('/admin/import-maps', e.message)); throw e; }
  redirect(withMsg('/admin/import-maps', 'Map retired. Files are no longer matched to it; past imports keep their record of it.'));
}
