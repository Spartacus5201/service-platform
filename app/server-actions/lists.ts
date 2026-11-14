'use server';
import { s as field } from './form';

/** Text field as typed (blank = empty string). */
const s = (fd: FormData, k: string) => field(fd, k) ?? '';
import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { saveService, ServiceListError } from '@/src/lists/services';
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
