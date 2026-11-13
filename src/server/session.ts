// Cookie sessions: a signed {userId, expiry} token. The user row is re-read on every request, so a deactivated
// user or a role change takes effect immediately. The signing secret is generated once and kept in the database.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from './db';
import { can, type Action, type Role, type Session } from '../auth/auth';

const COOKIE = 'sp_session';
const MAX_AGE_S = 60 * 60 * 12;

async function secret(): Promise<string> {
  const db = await getDb();
  const r = await db.query<{ value: string }>(`SELECT value FROM setting WHERE key='session_secret'`);
  if (r.rows[0]) return String(r.rows[0].value);
  const s = randomBytes(32).toString('hex');
  await db.query(`INSERT INTO setting (key,value) VALUES ('session_secret',$1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(s)]);
  return String((await db.query<{ value: string }>(`SELECT value FROM setting WHERE key='session_secret'`)).rows[0].value);
}

const sign = (payload: string, key: string) => createHmac('sha256', key).update(payload).digest('base64url');

export async function startSession(userId: string): Promise<void> {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + MAX_AGE_S * 1000 })).toString('base64url');
  const token = `${payload}.${sign(payload, await secret())}`;
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: MAX_AGE_S });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = sign(payload, await secret());
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  let parsed: { u: string; e: number };
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!parsed.u || parsed.e < Date.now()) return null;
  const r = await (await getDb()).query<{ id: string; email: string; name: string; role: Role; must_change_password: boolean }>(
    `SELECT id,email,name,role,must_change_password FROM app_user WHERE id=$1 AND active`, [parsed.u]);
  const u = r.rows[0];
  return u ? { userId: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.must_change_password } : null;
}

/** Pages and actions call this first. Redirects to login, or to the password change after a first sign-in. */
export async function requireSession(opts: { allowPasswordChange?: boolean } = {}): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.mustChangePassword && !opts.allowPasswordChange) redirect('/account/password');
  return s;
}

export async function requireCan(action: Action): Promise<Session> {
  const s = await requireSession();
  if (!can(s.role, action)) redirect('/?msg=' + encodeURIComponent('Your role cannot do that.'));
  return s;
}
