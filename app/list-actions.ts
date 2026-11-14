'use server';
import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { saveService, ServiceListError } from '@/src/lists/services';
import { withError, withMsg } from './ui';

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' ? v.trim() : ''; };

export async function saveServiceAction(fd: FormData) {
  const sess = await requireCan('manage_users');
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
