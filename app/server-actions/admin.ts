'use server';
import { ROLE_NAMES } from '@/src/admin/admin';
import type { Role } from '@/src/auth/auth';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { purgeExpiredImports } from '@/src/import/commit';
import { addUser, resetPassword, setRole, setActive, saveSettings } from '@/src/admin/admin';
import type { SecretState } from '../types';
import { withError, withMsg } from '../ui';
import { s, oneOf, n, msgOf, isRedirect, domainError } from './form';

// ---------- admin ----------
export async function addUserAction(_: SecretState, fd: FormData): Promise<SecretState> {
  const sess = await requireCan('manage_users');
  try {
    const r = await addUser(await getDb(), sess.userId, { email: s(fd, 'email') ?? '', name: s(fd, 'name') ?? '', role: oneOf(fd, 'role', ROLE_NAMES) ?? ('' as Role) });   // addUser refuses a role not on the list
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
    else await setRole(db, sess.userId, id, oneOf(fd, 'role', ROLE_NAMES) ?? ('' as Role));
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
