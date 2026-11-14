// Cookie sessions: a signed {userId, version, expiry} token. The user row is re-read on every request, so a
// deactivated user, a role change, a password change or a sign-out takes effect immediately (the version in the
// token must match the user's current session_version).
// The signing key is SESSION_SECRET when set, otherwise a key file kept beside the data folder (never in the
// database, so backups cannot be used to sign in), created on first use and readable only by the app's user.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { can, canOwn, canAny, loadAccess, type Permission, type Session } from '../auth/auth';

const COOKIE = 'sp_session';
const MAX_AGE_S = 60 * 60 * 12;

/** Where the key file lives: SESSION_KEY_FILE, else ".session-key" next to the data folder. */
export const keyFile = () => process.env.SESSION_KEY_FILE ?? join(dirname(resolve(process.env.DATA_DIR ?? '.pgdata')), '.session-key');

let cached: string | null = null;
export function sessionKey(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cached) return cached;
  const f = keyFile();
  if (!existsSync(f)) {
    mkdirSync(dirname(f), { recursive: true });
    try { writeFileSync(f, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }    // another process made it first
  }
  cached = readFileSync(f, 'utf8').trim();
  return cached;
}

/** Secure cookies by default in production; COOKIE_SECURE=false allows plain http (a laptop on its own). */
const secureCookie = () => (process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production');

const sign = (payload: string) => createHmac('sha256', sessionKey()).update(payload).digest('base64url');

export async function startSession(userId: string): Promise<void> {
  const v = (await (await getDb()).query<{ v: number }>(`SELECT session_version v FROM app_user WHERE id=$1`, [userId])).rows[0]?.v ?? 0;
  const payload = Buffer.from(JSON.stringify({ u: userId, v, e: Date.now() + MAX_AGE_S * 1000 })).toString('base64url');
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: 'lax', secure: secureCookie(), path: '/', maxAge: MAX_AGE_S });
}

/** Sign out: this browser's cookie goes, and every other session of the user stops working too. */
export async function endSession(): Promise<void> {
  const s = await getSession();
  if (s) await (await getDb()).query(`UPDATE app_user SET session_version = session_version + 1 WHERE id=$1`, [s.userId]);
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  let parsed: { u: string; v?: number; e: number };
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!parsed.u || parsed.e < Date.now()) return null;
  const db = await getDb();
  const r = await db.query<{ id: string; email: string; name: string; must_change_password: boolean }>(
    `SELECT id,email,name,must_change_password FROM app_user WHERE id=$1 AND active AND session_version=$2`, [parsed.u, parsed.v ?? -1]);
  const u = r.rows[0];
  return u ? { userId: u.id, email: u.email, name: u.name, mustChangePassword: u.must_change_password, ...(await loadAccess(db, u.id)) } : null;
}

/** Pages and actions call this first. Redirects to login, or to the password change after a first sign-in. */
export async function requireSession(opts: { allowPasswordChange?: boolean } = {}): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.mustChangePassword && !opts.allowPasswordChange) redirect('/account/password');
  return s;
}

/** For everything (scope "all"). */
export async function requireCan(p: Permission): Promise<Session> {
  const s = await requireSession();
  if (!can(s, p)) redirect('/?msg=' + encodeURIComponent('Your role cannot do that.'));
  return s;
}

/** At least for the person's own records (scope "own" or "all"). The caller limits what an "own" holder sees. */
export async function requireCanOwn(p: Permission): Promise<Session> {
  const s = await requireSession();
  if (!canOwn(s, p)) redirect('/?msg=' + encodeURIComponent('Your role cannot do that.'));
  return s;
}

/** Any of these (pages with sections for different permissions, such as Admin). */
export async function requireAny(ps: Permission[]): Promise<Session> {
  const s = await requireSession();
  if (!canAny(s, ps)) redirect('/?msg=' + encodeURIComponent('Your role cannot do that.'));
  return s;
}
