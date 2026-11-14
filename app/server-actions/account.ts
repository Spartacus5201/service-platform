'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { endSession, requireSession, startSession } from '@/src/server/session';
import { authenticate, changePassword, LoginLockedError } from '@/src/auth/auth';
import type { FormState } from '../types';
import { withError, withMsg } from '../ui';
import { createFirstAdmin, SetupDoneError } from '@/src/auth/setup';
import { s, msgOf } from './form';

// ---------- account ----------
export async function login(_: FormState, fd: FormData): Promise<FormState> {
  let sess;
  try { sess = await authenticate(await getDb(), s(fd, 'email') ?? '', String(fd.get('password') ?? '')); }
  catch (e) { if (e instanceof LoginLockedError) return { error: e.message }; throw e; }
  if (!sess) return { error: 'Email or password is incorrect.' };
  await startSession(sess.userId);
  redirect('/');
}

export async function firstAdminAction(fd: FormData) {
  const db = await getDb();
  const password = String(fd.get('password') ?? '');
  if (password !== String(fd.get('again') ?? '')) redirect(withError('/setup', 'The passwords do not match.'));
  let id: string;
  try {
    id = await createFirstAdmin(db, s(fd, 'setup_code') ?? '', { email: s(fd, 'email') ?? '', name: s(fd, 'name') ?? 'Administrator', password });
  } catch (e) {
    if (e instanceof SetupDoneError) redirect('/login');
    redirect(withError('/setup', msgOf(e)));
  }
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
  await startSession(sess.userId);              // the change ended every session, this one included
  redirect(withMsg('/', 'Password changed. Any other device you were signed in on is signed out.'));
}
