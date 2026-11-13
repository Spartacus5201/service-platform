// Built-in login for a handful of users. Kept behind this one module so SSO can replace it later:
// the rest of the app only ever sees `Session` and calls `authenticate`, `can`, and `changePassword`.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from '../db';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

export type Role = 'admin' | 'office' | 'coordinator' | 'technician';
export interface Session { userId: string; email: string; name: string; role: Role; mustChangePassword: boolean }

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

/** Format: scrypt$N$r$p$saltHex$hashHex */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new Error('Password must be at least 10 characters.');
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

export async function createUser(db: Db, u: { email: string; name: string; role: Role; password: string; mustChangePassword?: boolean }): Promise<string> {
  const hash = await hashPassword(u.password);
  const r = await db.query<{ id: string }>(
    `INSERT INTO app_user (email,name,role,password_hash,must_change_password) VALUES (lower($1),$2,$3,$4,$5)
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, password_hash=EXCLUDED.password_hash, must_change_password=EXCLUDED.must_change_password, active=true
     RETURNING id`,
    [u.email.trim(), u.name, u.role, hash, u.mustChangePassword ?? true]);
  return r.rows[0].id;
}

// A real hash to compare against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY = 'scrypt$16384$8$1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';

export async function authenticate(db: Db, email: string, password: string): Promise<Session | null> {
  const r = await db.query<{ id: string; email: string; name: string; role: Role; password_hash: string; must_change_password: boolean }>(
    `SELECT id,email,name,role,password_hash,must_change_password FROM app_user WHERE email=lower($1) AND active`, [email.trim()]);
  const u = r.rows[0];
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY);
  if (!u || !ok) {
    await db.query(`INSERT INTO audit_log (action,entity,detail) VALUES ('login_failed','user',$1)`, [JSON.stringify({ email: email.trim().toLowerCase() })]);
    return null;
  }
  await db.query(`INSERT INTO audit_log (user_id,action,entity) VALUES ($1,'login','user')`, [u.id]);
  return { userId: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.must_change_password };
}

export async function changePassword(db: Db, userId: string, current: string, next: string): Promise<boolean> {
  const r = await db.query<{ password_hash: string }>(`SELECT password_hash FROM app_user WHERE id=$1`, [userId]);
  if (!r.rows[0] || !(await verifyPassword(current, r.rows[0].password_hash))) return false;
  await db.query(`UPDATE app_user SET password_hash=$2, must_change_password=false WHERE id=$1`, [userId, await hashPassword(next)]);
  await db.query(`INSERT INTO audit_log (user_id,action,entity) VALUES ($1,'password_changed','user')`, [userId]);
  return true;
}

export type Action =
  | 'view_prices' | 'edit_prices' | 'import_reports' | 'edit_documents' | 'record_service'
  | 'manage_users' | 'manage_settings' | 'view_history';

const GRANTS: Record<Role, Action[]> = {
  admin: ['view_prices', 'edit_prices', 'import_reports', 'edit_documents', 'record_service', 'manage_users', 'manage_settings', 'view_history'],
  office: ['view_prices', 'edit_prices', 'import_reports', 'edit_documents', 'record_service', 'view_history'],
  coordinator: ['view_prices', 'import_reports', 'edit_documents', 'record_service', 'view_history'],
  technician: ['record_service', 'view_history'],      // technicians never see prices
};

export const can = (role: Role, action: Action): boolean => GRANTS[role].includes(action);

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
    if (!(role in GRANTS)) throw new Error(`Unknown role "${cells[2]}" for ${cells[0]}.`);
    out.push({ email: cells[0], name: cells[1], role, password: cells[3] });
  }
  return out;
}
