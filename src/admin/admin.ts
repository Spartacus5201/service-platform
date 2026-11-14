// User and settings administration. Kept free of web code so it is testable and reusable.
import { randomInt } from 'node:crypto';
import type { Db } from '../db';
import { hashPassword, type Role } from '../auth/auth';

export class AdminError extends Error {}
export const ROLES: { role: Role; label: string; help: string }[] = [
  { role: 'admin', label: 'Admin', help: 'Everything, including users and settings.' },
  { role: 'office', label: 'Office', help: 'Prices, documents, imports, invoicing, service entry.' },
  { role: 'coordinator', label: 'Coordinator', help: 'Documents, imports and service entry; sees prices but cannot change them.' },
  { role: 'technician', label: 'Technician', help: 'Service entry and history; never sees prices.' },
];

export interface UserRow { id: string; email: string; name: string; role: Role; active: boolean; must_change_password: boolean; created_at: string; last_login: string | null }

export async function listUsers(db: Db): Promise<UserRow[]> {
  return (await db.query<UserRow>(
    `SELECT u.id,u.email,u.name,u.role,u.active,u.must_change_password,u.created_at::text,
            (SELECT max(at)::text FROM audit_log l WHERE l.user_id=u.id AND l.action='login') last_login
       FROM app_user u ORDER BY u.active DESC, u.name`)).rows;
}

/** 14 characters from an alphabet without look-alikes (no 0/O, 1/l/I). Shown once; the user must replace it at first sign-in. */
export function tempPassword(): string {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 14 }, () => a[randomInt(a.length)]).join('');
}

const log = (db: Db, by: string | null, action: string, target: string, detail: object) =>
  db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,$2,'user',$3,$4)`, [by, action, target, JSON.stringify(detail)]);

async function otherActiveAdmins(db: Db, excluding: string): Promise<number> {
  return Number((await db.query<{ n: string }>(`SELECT count(*) n FROM app_user WHERE role='admin' AND active AND id<>$1`, [excluding])).rows[0].n);
}

export async function addUser(db: Db, by: string | null, i: { email: string; name: string; role: Role }): Promise<{ id: string; password: string }> {
  const email = i.email.trim().toLowerCase(); const name = i.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AdminError('Enter a valid email address.');
  if (!name) throw new AdminError('Enter a name.');
  if (!ROLES.some((r) => r.role === i.role)) throw new AdminError('Pick a role.');
  if ((await db.query(`SELECT 1 FROM app_user WHERE email=$1`, [email])).rows.length) throw new AdminError(`${email} already has an account.`);
  const password = tempPassword();
  const id = (await db.query<{ id: string }>(`INSERT INTO app_user (email,name,role,password_hash,must_change_password) VALUES ($1,$2,$3,$4,true) RETURNING id`,
    [email, name, i.role, await hashPassword(password)])).rows[0].id;
  await log(db, by, 'user_created', id, { email, role: i.role });
  return { id, password };
}

export async function resetPassword(db: Db, by: string | null, userId: string): Promise<string> {
  const password = tempPassword();
  const r = await db.query(`UPDATE app_user SET password_hash=$2, must_change_password=true WHERE id=$1`, [userId, await hashPassword(password)]);
  if (!r.affectedRows) throw new AdminError('Unknown user.');
  await log(db, by, 'password_reset', userId, {});
  return password;
}

export async function setRole(db: Db, by: string | null, userId: string, role: Role): Promise<void> {
  if (!ROLES.some((r) => r.role === role)) throw new AdminError('Pick a role.');
  const u = (await db.query<{ role: Role; active: boolean }>(`SELECT role,active FROM app_user WHERE id=$1`, [userId])).rows[0];
  if (!u) throw new AdminError('Unknown user.');
  if (u.role === 'admin' && role !== 'admin' && u.active && (await otherActiveAdmins(db, userId)) === 0) throw new AdminError('There must be at least one active admin.');
  await db.query(`UPDATE app_user SET role=$2 WHERE id=$1`, [userId, role]);
  await log(db, by, 'role_changed', userId, { from: u.role, to: role });
}

export async function setActive(db: Db, by: string | null, userId: string, active: boolean): Promise<void> {
  const u = (await db.query<{ role: Role; active: boolean }>(`SELECT role,active FROM app_user WHERE id=$1`, [userId])).rows[0];
  if (!u) throw new AdminError('Unknown user.');
  if (!active && u.role === 'admin' && u.active && (await otherActiveAdmins(db, userId)) === 0) throw new AdminError('There must be at least one active admin.');
  await db.query(`UPDATE app_user SET active=$2 WHERE id=$1`, [userId, active]);
  await log(db, by, active ? 'user_reactivated' : 'user_deactivated', userId, {});
}

// ---------- settings ----------
export interface SettingSpec { key: string; label: string; help: string; unit: string; min: number; max: number; decimal?: boolean }
export const SETTINGS: SettingSpec[] = [
  { key: 'int_read_threshold', label: 'INT: maximum reads', help: 'An automated INT unit with this many reads or fewer in the audit window is a candidate for service.', unit: 'reads', min: 1, max: 1000 },
  { key: 'int_stale_days', label: 'INT: days since last real read', help: 'An INT candidate needs service when its last real read was at least this many days before the audit ended.', unit: 'days', min: 0, max: 60 },
  { key: 'warranty_months_install', label: 'Install warranty', help: 'Parts and labor on equipment we installed, from the install completion date.', unit: 'months', min: 0, max: 120 },
  { key: 'warranty_months_service', label: 'Service warranty', help: 'Labor and replaced parts, from the service visit.', unit: 'months', min: 0, max: 120 },
  { key: 'expiring_window_days', label: 'Expiring-soon window', help: 'Warranty shows as Expiring this many days before it ends.', unit: 'days', min: 0, max: 365 },
  { key: 'quote_valid_days', label: 'Quote validity', help: 'Proposals and WAs show as expired after this many days; they can still be approved with a price reconfirmation.', unit: 'days', min: 1, max: 365 },
  { key: 'labor_rate', label: 'Default labor charge', help: 'Starting labor price per unit on new document lines and invoices. Every line can be changed by hand.', unit: 'dollars', min: 0, max: 10000, decimal: true },
  { key: 'post_audit_days', label: 'Post-service audit due', help: 'Days after a visit when the follow-up audit is expected. After that, visits with units still awaiting an audit appear on Today.', unit: 'days', min: 1, max: 90 },
  { key: 'audit_interval_days', label: 'Audit every', help: 'Days between audits of a property. Until it is set the Properties list shows no due dates; once set it shows when each audit is due and marks late ones.', unit: 'days', min: 30, max: 1095 },
  { key: 'pm_battery_threshold', label: 'Low battery: flag level', help: 'A transmitter at or below this battery percent is flagged low (PM) on audits, the low battery report and Today.', unit: 'percent', min: 1, max: 99 },
  { key: 'pm_wa_threshold', label: 'Low battery: WA level', help: 'At or below this battery percent the battery goes on new WAs and Proposals: a PM battery line while it still reads, or a battery instead of a new transmitter when it has stopped.', unit: 'percent', min: 1, max: 99 },
  { key: 'pm_battery_price', label: 'Default battery price', help: 'Used when the catalog has no battery for the transmitter model. Labor uses the default labor charge.', unit: 'dollars', min: 0, max: 1000, decimal: true },
  { key: 'raw_import_retention_days', label: 'Keep raw import files', help: 'Uploaded report files are deleted after this many days. Parsed readings and history are kept forever. Applies to new imports.', unit: 'days', min: 7, max: 3650 },
];

export async function getSettings(db: Db): Promise<Record<string, number>> {
  const r = await db.query<{ key: string; value: unknown }>(`SELECT key,value FROM setting`);
  return Object.fromEntries(r.rows.map((x) => [x.key, Number(x.value)]));
}

export async function saveSettings(db: Db, by: string | null, input: Record<string, string>): Promise<string[]> {
  const cur = await getSettings(db); const changed: string[] = []; const next: [string, number][] = [];
  for (const s of SETTINGS) {
    const raw = input[s.key]?.trim(); if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || (!s.decimal && !Number.isInteger(n)) || (s.decimal && Math.round(n * 100) !== n * 100) || n < s.min || n > s.max)
      throw new AdminError(`${s.label} must be ${s.decimal ? 'a dollar amount' : 'a whole number'} from ${s.min} to ${s.max}.`);
    if (cur[s.key] !== n) { next.push([s.key, n]); changed.push(s.label); }
  }
  for (const [k, n] of next) {
    await db.query(`INSERT INTO setting (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [k, JSON.stringify(n)]);
    await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'setting_changed','setting',$2,$3)`, [by, k, JSON.stringify({ from: cur[k], to: n })]);
  }
  return changed;
}

export async function rawFileStats(db: Db): Promise<{ kept: number; due: number; bytes: number }> {
  const r = (await db.query<{ kept: string; due: string; bytes: string }>(
    `SELECT count(*) FILTER (WHERE raw_file IS NOT NULL) kept, count(*) FILTER (WHERE raw_file IS NOT NULL AND purge_after <= current_date) due,
            COALESCE(sum(length(raw_file)),0) bytes FROM import_batch`)).rows[0];
  return { kept: Number(r.kept), due: Number(r.due), bytes: Number(r.bytes) };
}

const ACTION_LABEL: Record<string, string> = {
  login: 'Signed in', login_failed: 'Failed sign-in', password_changed: 'Changed password', setting_changed: 'Changed a setting',
  audit_override: 'Changed an audit result', audit_override_cleared: 'Cleared an audit change', catalog_import: 'Imported catalog prices',
  closeout_approved: 'Approved client notes', event_corrected: 'Corrected a service entry', invoice_ref_recorded: 'Recorded an invoice reference',
  price_reconfirmed: 'Reconfirmed prices', import_layout_saved: 'Saved an import map', import_layout_retired: 'Retired an import map',
};
export interface ActivityRow { id: string; at: string; who: string | null; action: string; label: string; entity: string | null; entityId: string | null; detail: string }

/** Newest first. `action` limits to one kind; `user` to one person; `before` pages back from an id. */
export async function listActivity(db: Db, o: { action?: string; userId?: string; before?: string; limit?: number } = {}): Promise<{ rows: ActivityRow[]; actions: string[]; more: boolean }> {
  const limit = Math.min(o.limit ?? 100, 500); const args: unknown[] = []; const where: string[] = [];
  if (o.action) { args.push(o.action); where.push(`l.action=$${args.length}`); }
  if (o.userId) { args.push(o.userId); where.push(`l.user_id=$${args.length}`); }
  if (o.before && /^\d+$/.test(o.before)) { args.push(o.before); where.push(`l.id < $${args.length}`); }
  const r = await db.query<{ id: string; at: string; who: string | null; action: string; entity: string | null; entity_id: string | null; detail: unknown }>(
    `SELECT l.id::text id, l.at::text "at", u.name who, l.action, l.entity, l.entity_id, l.detail FROM audit_log l LEFT JOIN app_user u ON u.id=l.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT ${limit + 1}`, args);
  const actions = (await db.query<{ action: string }>(`SELECT DISTINCT action FROM audit_log ORDER BY action`)).rows.map((x) => x.action);
  return {
    rows: r.rows.slice(0, limit).map((x) => ({
      id: x.id, at: x.at, who: x.who, action: x.action, label: ACTION_LABEL[x.action] ?? x.action.replace(/_/g, ' '), entity: x.entity, entityId: x.entity_id,
      detail: x.detail && typeof x.detail === 'object' && Object.keys(x.detail as object).length ? Object.entries(x.detail as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : '',
    })),
    actions, more: r.rows.length > limit,
  };
}
