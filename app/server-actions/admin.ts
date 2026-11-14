'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { purgeExpiredImports } from '@/src/import/commit';
import { addUser, resetPassword, setActive, saveSettings } from '@/src/admin/admin';
import { setUserRoles, saveRolePermissions, restoreDefaults, addRole, renameRole, setRoleRetired } from '@/src/admin/roles';
import { PERMISSIONS, type Scope } from '@/src/auth/permissions';
import type { SecretState } from '../types';
import { withError, withMsg } from '../ui';
import { s, oneOf, n, msgOf, isRedirect, domainError } from './form';

// ---------- admin ----------
export async function addUserAction(_: SecretState, fd: FormData): Promise<SecretState> {
  const sess = await requireCan('users.manage');
  try {
    const r = await addUser(await getDb(), sess.userId, { email: s(fd, 'email') ?? '', name: s(fd, 'name') ?? '', roles: fd.getAll('roles').map(String) });
    revalidatePath('/admin');
    return { password: r.password, who: s(fd, 'email') ?? '' };
  } catch (e) { if (domainError(e)) return { error: msgOf(e) }; throw e; }
}
export async function resetPasswordAction(_: SecretState, fd: FormData): Promise<SecretState> {
  const sess = await requireCan('users.manage');
  try { revalidatePath('/admin'); return { password: await resetPassword(await getDb(), sess.userId, s(fd, 'user_id')!), who: s(fd, 'who') ?? '' }; }
  catch (e) { if (domainError(e)) return { error: msgOf(e) }; throw e; }
}
export async function userChangeAction(fd: FormData) {
  const sess = await requireCan('users.manage');
  const id = s(fd, 'user_id')!; const db = await getDb();
  try {
    if (s(fd, 'intent') === 'deactivate') await setActive(db, sess.userId, id, false);
    else if (s(fd, 'intent') === 'reactivate') await setActive(db, sess.userId, id, true);
    else await setUserRoles(db, sess.userId, id, fd.getAll('roles').map(String));
  } catch (e) { if (domainError(e)) redirect(withError('/admin', msgOf(e))); throw e; }
  redirect(withMsg('/admin', 'Saved.'));
}
export async function saveSettingsAction(fd: FormData) {
  const sess = await requireCan('rules.edit');
  const input: Record<string, string> = {}; for (const [k, v] of fd.entries()) if (typeof v === 'string') input[k] = v;
  try {
    const changed = await saveSettings(await getDb(), sess.userId, input);
    redirect(withMsg('/admin', changed.length ? `Saved: ${changed.join(', ')}.` : 'No changes.'));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError('/admin', msgOf(e))); throw e; }
}
export async function purgeNowAction() {
  await requireCan('settings.system');
  const n = await purgeExpiredImports(await getDb());
  redirect(withMsg('/admin', `${n} expired raw file(s) deleted.`));
}

// ---------- roles ----------
const ROLES_PAGE = '/admin/roles';
export async function saveRoleAction(fd: FormData) {
  const sess = await requireCan('roles.manage');
  const key = s(fd, 'role_key') ?? ''; const db = await getDb();
  let msg: string;
  try {
    if (s(fd, 'intent') === 'restore') msg = `${await restoreDefaults(db, sess.userId, key)} permission(s) set back to the default.`;
    else if (s(fd, 'intent') === 'retire') { await setRoleRetired(db, sess.userId, key, true); msg = 'Role retired. People who hold it get nothing from it until it is brought back.'; }
    else if (s(fd, 'intent') === 'unretire') { await setRoleRetired(db, sess.userId, key, false); msg = 'Role brought back.'; }
    else {
      await renameRole(db, sess.userId, key, s(fd, 'name') ?? '', s(fd, 'description'));
      const perms: Record<string, Scope | null> = {};
      for (const p of PERMISSIONS) { const v = s(fd, `p:${p.key}`); perms[p.key] = v === 'all' || v === 'own' ? v : null; }
      msg = `${await saveRolePermissions(db, sess.userId, key, perms)} permission(s) changed.`;
    }
  } catch (e) { if (domainError(e)) redirect(withError(`${ROLES_PAGE}?role=${key}`, msgOf(e))); throw e; }
  redirect(withMsg(`${ROLES_PAGE}?role=${key}`, msg));
}
export async function addRoleAction(fd: FormData) {
  const sess = await requireCan('roles.manage');
  let key: string;
  try { key = await addRole(await getDb(), sess.userId, { name: s(fd, 'name') ?? '', description: s(fd, 'description'), copyFrom: s(fd, 'copy_from') }); }
  catch (e) { if (domainError(e)) redirect(withError(ROLES_PAGE, msgOf(e))); throw e; }
  redirect(withMsg(`${ROLES_PAGE}?role=${key}`, 'Role added. Tick what it can do, then save.'));
}
