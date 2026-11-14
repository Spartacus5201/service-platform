'use server';
import { s as field } from './form';

/** Text field as typed (blank = empty string). */
const s = (fd: FormData, k: string) => field(fd, k) ?? '';
import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { saveService, ServiceListError } from '@/src/lists/services';
import { saveListItem, restoreListItem, ListError } from '@/src/lists/lists';
import { withError, withMsg } from '../ui';


export async function saveServiceAction(fd: FormData) {
  const sess = await requireCan('lists.edit');
  let r: string;
  try {
    r = await saveService(await getDb(), sess.userId, {
      code: s(fd, 'code'), name: s(fd, 'name'), words: s(fd, 'words').split(/[,;\n]/), active: fd.get('active') === 'on',
      sort: s(fd, 'sort') ? Number(s(fd, 'sort')) : undefined,
    });
  } catch (e) {
    if (e instanceof ServiceListError) redirect(withError('/admin/services', e.message));
    throw e;
  }
  redirect(withMsg('/admin/services', r === 'added' ? `Added ${s(fd, 'code').toUpperCase()}.` : r === 'changed' ? `Saved ${s(fd, 'code').toUpperCase()}.` : 'No change.'));
}

// ---------- editable lists (Admin > Lists) ----------

export async function saveListItemAction(fd: FormData) {
  const sess = await requireCan('lists.edit');
  const list = s(fd, 'list'); const code = s(fd, 'code') || null; const back = `/admin/lists?list=${encodeURIComponent(list)}`;
  let r: string;
  try {
    r = await saveListItem(await getDb(), sess.userId, {
      list, code, newCode: s(fd, 'new_code') || null, label: s(fd, 'label'), wording: s(fd, 'wording'), worksLike: s(fd, 'works_like') || null,
      active: fd.get('active') === 'on', sort: s(fd, 'sort') ? Number(s(fd, 'sort')) : null,
    });
  } catch (e) {
    if (e instanceof ListError) redirect(withError(back, e.message));
    throw e;
  }
  redirect(withMsg(back, r === 'added' ? 'Added.' : r === 'changed' ? 'Saved.' : 'No change.'));
}

export async function restoreListItemAction(fd: FormData) {
  const sess = await requireCan('lists.edit');
  const list = s(fd, 'list'); const back = `/admin/lists?list=${encodeURIComponent(list)}`;
  try { await restoreListItem(await getDb(), sess.userId, list, s(fd, 'code')); }
  catch (e) { if (e instanceof ListError) redirect(withError(back, e.message)); throw e; }
  redirect(withMsg(back, 'Restored as shipped.'));
}
