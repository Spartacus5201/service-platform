'use server';
import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { dropHeldImport, getSnapshot, heldImport, holdForImport, importSetup, parseSetup } from '@/src/admin/setup';
import { localTime, withError, withMsg } from '../ui';
import { s, msgOf, isRedirect, domainError } from './form';

const BACK = '/admin/setup';
const MAX = 20 * 1024 * 1024;

/** Read an uploaded setup file and hold it for preview. */
export async function previewSetupAction(fd: FormData) {
  const sess = await requireCan('settings.system');
  const f = fd.get('file');
  try {
    if (!(f instanceof File) || f.size === 0) redirect(withError(BACK, 'Choose a setup file first.'));
    if ((f as File).size > MAX) redirect(withError(BACK, 'That file is too large for a setup file.'));
    await holdForImport(await getDb(), sess.userId, (f as File).name, parseSetup(await (f as File).text()));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError(BACK, msgOf(e))); throw e; }
  redirect(`${BACK}#preview`);
}

/** Hold a snapshot for preview, to put the setup back as it was. */
export async function previewSnapshotAction(fd: FormData) {
  const sess = await requireCan('settings.system');
  const db = await getDb();
  const id = s(fd, 'snapshot_id') ?? '';
  const snap = await getSnapshot(db, id);
  if (!snap) redirect(withError(BACK, 'That snapshot is not there.'));
  const at = (await db.query<{ t: string }>(`SELECT taken_at::text t FROM setup_snapshot WHERE id=$1`, [id])).rows[0]?.t;
  await holdForImport(db, sess.userId, `Snapshot of ${at ? localTime(at) : 'an earlier setup'}`, snap!);
  redirect(`${BACK}#preview`);
}

export async function importSetupAction() {
  const sess = await requireCan('settings.system');
  const db = await getDb();
  let n = 0;
  try {
    const held = await heldImport(db, sess.userId);
    if (!held) redirect(withError(BACK, 'Choose a setup file first.'));
    n = (await importSetup(db, sess.userId, held!.file, `Before importing ${held!.source}`)).total;
    await dropHeldImport(db, sess.userId);
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError(BACK, msgOf(e))); throw e; }
  redirect(withMsg(BACK, n ? `Setup imported: ${n} change${n === 1 ? '' : 's'}. The setup as it was is kept below.` : 'Setup imported: nothing was different.'));
}

export async function cancelSetupImportAction() {
  const sess = await requireCan('settings.system');
  await dropHeldImport(await getDb(), sess.userId);
  redirect(withMsg(BACK, 'Import cancelled.'));
}
