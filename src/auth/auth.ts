// Built-in login for a handful of users. Kept behind this one module so SSO can replace it later:
// the rest of the app only ever sees `Session` and calls `authenticate`, `can`, and `changePassword`.
import { UserError } from '../errors';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db, Q } from '../db';
import { isPermission, LEGACY_ROLES, BUILTIN_ROLES, type Permission, type Scope } from './permissions';
export type { Permission } from './permissions';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

/** A role key (admin, manager, coordinator, scheduler, technician, billing, or one an Admin added). */
export type Role = string;
export interface Session {
  userId: string; email: string; name: string; roles: Role[]; mustChangePassword: boolean;
  /** What the person may do: the union of their roles' permissions ("all" wins over "own"). */
  perms: Partial<Record<Permission, Scope>>;
}

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

/** Format: scrypt$N$r$p$saltHex$hashHex */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new UserError('Password must be at least 10 characters.');
  const salt = randomBytes(16);
  const h = await scrypt(password, salt, KEYLEN, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('hex'), h.toString('hex')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: +N, r: +r, p: +p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Create (or re-create) a user. `roles` are role keys; `role` is accepted for scripts and the credentials file and
 * may be one of the old names (admin, office, coordinator, technician), which map as in LEGACY_ROLES.
 */
export async function createUser(db: Q, u: { email: string; name: string; role?: Role; roles?: Role[]; password: string; mustChangePassword?: boolean }): Promise<string> {
  const hash = await hashPassword(u.password);
  const roles = u.roles ?? (u.role ? LEGACY_ROLES[u.role] ?? [u.role] : []);
  const r = await db.query<{ id: string }>(
    `INSERT INTO app_user (email,name,password_hash,must_change_password) VALUES (lower($1),$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, must_change_password=EXCLUDED.must_change_password, active=true
     RETURNING id`,
    [u.email.trim(), u.name, hash, u.mustChangePassword ?? true]);
  const id = r.rows[0].id;
  await db.query(`DELETE FROM user_role WHERE user_id=$1`, [id]);
  for (const k of roles) await db.query(`INSERT INTO user_role (user_id, role_key) VALUES ($1,$2)`, [id, k]);
  return id;
}

/** A person's active roles and the permissions they add up to. */
export async function loadAccess(q: Q, userId: string): Promise<{ roles: Role[]; perms: Partial<Record<Permission, Scope>> }> {
  const rows = (await q.query<{ role_key: string; permission: string | null; scope: Scope | null }>(
    `SELECT ur.role_key, rp.permission, rp.scope FROM user_role ur JOIN role r ON r.key=ur.role_key AND r.retired_at IS NULL
       LEFT JOIN role_permission rp ON rp.role_key=ur.role_key WHERE ur.user_id=$1`, [userId])).rows;
  const perms: Partial<Record<Permission, Scope>> = {};
  for (const r of rows) if (r.permission && isPermission(r.permission)) perms[r.permission] = perms[r.permission] === 'all' || r.scope === 'all' ? 'all' : 'own';
  return { roles: [...new Set(rows.map((r) => r.role_key))], perms };
}

// A real hash to compare against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY = 'scrypt$16384$8$1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';

/** Failed sign-ins allowed per email, and in total, in the last 15 minutes before sign-in is refused for a while. */
export const LOGIN_LIMITS = { perEmail: 8, total: 60, minutes: 15 };
export class LoginLockedError extends UserError {}

export async function authenticate(db: Db, email: string, password: string): Promise<Session | null> {
  const recent = (await db.query<{ mine: string; total: string }>(
    `SELECT count(*) FILTER (WHERE detail->>'email' = lower(trim($1))) mine, count(*) total FROM audit_log
      WHERE action='login_failed' AND at > now() - make_interval(mins => $2)`, [email, LOGIN_LIMITS.minutes])).rows[0];
  if (Number(recent.mine) >= LOGIN_LIMITS.perEmail || Number(recent.total) >= LOGIN_LIMITS.total)
    throw new LoginLockedError(`Too many failed sign-ins. Wait ${LOGIN_LIMITS.minutes} minutes and try again, or ask an admin to reset the password.`);
  const r = await db.query<{ id: string; email: string; name: string; password_hash: string; must_change_password: boolean }>(
    `SELECT id,email,name,password_hash,must_change_password FROM app_user WHERE email=lower($1) AND active`, [email.trim()]);
  const u = r.rows[0];
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY);
  if (!u || !ok) {
    await db.query(`INSERT INTO audit_log (action,entity,detail) VALUES ('login_failed','user',$1)`, [JSON.stringify({ email: email.trim().toLowerCase() })]);
    return null;
  }
  await db.query(`INSERT INTO audit_log (user_id,action,entity) VALUES ($1,'login','user')`, [u.id]);
  return { userId: u.id, email: u.email, name: u.name, mustChangePassword: u.must_change_password, ...(await loadAccess(db, u.id)) };
}

export async function changePassword(db: Db, userId: string, current: string, next: string): Promise<boolean> {
  const r = await db.query<{ password_hash: string }>(`SELECT password_hash FROM app_user WHERE id=$1`, [userId]);
  if (!r.rows[0] || !(await verifyPassword(current, r.rows[0].password_hash))) return false;
  // Every other session of this user ends (the caller starts a fresh one for this browser).
  await db.query(`UPDATE app_user SET password_hash=$2, must_change_password=false, session_version=session_version+1 WHERE id=$1`, [userId, await hashPassword(next)]);
  await db.query(`INSERT INTO audit_log (user_id,action,entity) VALUES ($1,'password_changed','user')`, [userId]);
  return true;
}

/** May this person do this for everything? */
export const can = (s: Pick<Session, 'perms'> | null | undefined, p: Permission): boolean => s?.perms[p] === 'all';
/** May this person do this at least for their own records? */
export const canOwn = (s: Pick<Session, 'perms'> | null | undefined, p: Permission): boolean => !!s?.perms[p];
/** Any of these, for everything (e.g. whether to show the Admin menu). */
export const canAny = (s: Pick<Session, 'perms'> | null | undefined, ps: Permission[]): boolean => ps.some((p) => can(s, p));

/**
 * Parse a local credentials file (never committed): a markdown table with
 * columns email | name | role | temporary password.
 */
export function parseCredentialsMd(md: string, onSkip?: (line: string) => void): { email: string; name: string; role: Role; password: string }[] {
  const out: { email: string; name: string; role: Role; password: string }[] = [];
  for (const line of md.split('\n')) {
    const cells = line.split('|').map((c) => c.trim()).filter((_, i, a) => !(i === 0 && a[0] === '') );
    const isEmail = (c: string) => /^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(c);
    if (!cells.some(isEmail)) continue;                                   // header, separator, prose, pasted commands
    if (cells.length < 4 || !isEmail(cells[0])) { onSkip?.(line.trim()); continue; }   // stray text: skipped, and reported
    const role = cells[2].toLowerCase() as Role;
    const known = [...Object.keys(LEGACY_ROLES), ...BUILTIN_ROLES.map((r) => r.key)];
    if (!known.includes(role)) throw new UserError(`Unknown role "${cells[2]}" for ${cells[0]}. Use one of: ${[...new Set(known)].join(', ')}.`);
    out.push({ email: cells[0], name: cells[1], role, password: cells[3] });
  }
  return out;
}
