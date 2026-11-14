// Roles as data: names, which permissions each holds, and who holds which roles. Every change is logged with
// before and after, runs in one transaction, and is refused if it would leave nobody able to manage users and roles.
import type { Db, Q } from '../db';
import { UserError } from '../errors';
import { BUILTIN_ROLES, DEFAULT_GRID, PERMISSIONS, isPermission, type Permission, type Scope } from '../auth/permissions';

export class RoleError extends UserError {}

export interface RoleRow { key: string; name: string; description: string | null; builtin: boolean; retired: boolean; sort: number; users: number; perms: Partial<Record<Permission, Scope>> }

export async function listRoles(q: Q, o: { includeRetired?: boolean } = {}): Promise<RoleRow[]> {
  const roles = (await q.query<{ key: string; name: string; description: string | null; builtin: boolean; retired: boolean; sort: number; users: string }>(
    `SELECT r.key, r.name, r.description, r.builtin, r.retired_at IS NOT NULL retired, r.sort,
            (SELECT count(*) FROM user_role ur JOIN app_user u ON u.id=ur.user_id AND u.active WHERE ur.role_key=r.key) users
       FROM role r ${o.includeRetired ? '' : 'WHERE r.retired_at IS NULL'} ORDER BY r.sort, r.name`)).rows;
  const grid = (await q.query<{ role_key: string; permission: string; scope: Scope }>(`SELECT role_key, permission, scope FROM role_permission`)).rows;
  return roles.map((r) => ({ ...r, users: Number(r.users),
    perms: Object.fromEntries(grid.filter((g) => g.role_key === r.key && isPermission(g.permission)).map((g) => [g.permission, g.scope])) }));
}

const log = (q: Q, by: string | null, action: string, entity: string, id: string, detail: object) =>
  q.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,$2,$3,$4,$5)`, [by, action, entity, id, JSON.stringify(detail)]);

/** After a change: someone active must still be able to manage users AND roles, or the change is undone. */
async function keepAnAdmin(q: Q) {
  const n = Number((await q.query<{ n: string }>(
    `SELECT count(*) n FROM app_user u WHERE u.active
        AND EXISTS (SELECT 1 FROM user_role ur JOIN role r ON r.key=ur.role_key AND r.retired_at IS NULL JOIN role_permission p ON p.role_key=r.key
                     WHERE ur.user_id=u.id AND p.permission='users.manage' AND p.scope='all')
        AND EXISTS (SELECT 1 FROM user_role ur JOIN role r ON r.key=ur.role_key AND r.retired_at IS NULL JOIN role_permission p ON p.role_key=r.key
                     WHERE ur.user_id=u.id AND p.permission='roles.manage' AND p.scope='all')`)).rows[0].n);
  if (n === 0) throw new RoleError('That would leave nobody who can manage users and roles. Give someone the Admin role first.');
}

/** Replace a role's permissions. Admin's own user and role management cannot be taken from the Admin role. */
export async function saveRolePermissions(db: Db, by: string | null, roleKey: string, perms: Partial<Record<string, Scope | null>>): Promise<number> {
  return db.transaction(async (tx) => {
    const role = (await listRoles(tx, { includeRetired: true })).find((r) => r.key === roleKey);
    if (!role) throw new RoleError('Unknown role.');
    const next: Partial<Record<Permission, Scope>> = {};
    for (const [k, v] of Object.entries(perms)) {
      if (!v) continue;
      if (!isPermission(k)) throw new RoleError(`Unknown permission ${k}.`);
      const def = PERMISSIONS.find((p) => p.key === k)!;
      if (v === 'own' && !('own' in def && def.own)) throw new RoleError(`"${def.label}" cannot be limited to a person's own records.`);
      next[k] = v;
    }
    if (roleKey === 'admin') for (const p of PERMISSIONS) if ('locked' in p && p.locked && next[p.key] !== 'all') throw new RoleError(`The Admin role always keeps "${p.label}".`);
    const changed = PERMISSIONS.map((p) => p.key).filter((k) => (role.perms[k] ?? null) !== (next[k] ?? null));
    if (!changed.length) return 0;
    await tx.query(`DELETE FROM role_permission WHERE role_key=$1`, [roleKey]);
    for (const [k, v] of Object.entries(next)) await tx.query(`INSERT INTO role_permission (role_key,permission,scope) VALUES ($1,$2,$3)`, [roleKey, k, v]);
    await keepAnAdmin(tx);
    await log(tx, by, 'role_permissions_changed', 'role', roleKey, Object.fromEntries(changed.map((k) => [k, { from: role.perms[k] ?? null, to: next[k] ?? null }])));
    return changed.length;
  });
}

export async function restoreDefaults(db: Db, by: string | null, roleKey: string): Promise<number> {
  const d = DEFAULT_GRID[roleKey];
  if (!d) throw new RoleError('Only a built-in role has defaults to restore.');
  return saveRolePermissions(db, by, roleKey, d);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'r_$1').slice(0, 30);

/** A new role, empty or copying another role's permissions. */
export async function addRole(db: Db, by: string | null, r: { name: string; description?: string | null; copyFrom?: string | null }): Promise<string> {
  const name = r.name.trim(); if (!name) throw new RoleError('Give the role a name.');
  const key = slug(name); if (key.length < 2) throw new RoleError('Use at least two letters in the name.');
  return db.transaction(async (tx) => {
    if ((await tx.query(`SELECT 1 FROM role WHERE key=$1 OR lower(name)=lower($2)`, [key, name])).rows.length) throw new RoleError(`There is already a role called ${name}.`);
    await tx.query(`INSERT INTO role (key,name,description,sort) VALUES ($1,$2,$3,(SELECT coalesce(max(sort),0)+1 FROM role))`, [key, name, r.description?.trim() || null]);
    if (r.copyFrom) await tx.query(`INSERT INTO role_permission (role_key,permission,scope) SELECT $1, permission, scope FROM role_permission WHERE role_key=$2`, [key, r.copyFrom]);
    await log(tx, by, 'role_added', 'role', key, { name, copyFrom: r.copyFrom ?? null });
    return key;
  });
}

export async function renameRole(db: Db, by: string | null, key: string, name: string, description: string | null): Promise<void> {
  if (!name.trim()) throw new RoleError('Give the role a name.');
  const cur = (await db.query<{ name: string; description: string | null }>(`SELECT name, description FROM role WHERE key=$1`, [key])).rows[0];
  if (!cur) throw new RoleError('Unknown role.');
  if ((await db.query(`SELECT 1 FROM role WHERE lower(name)=lower($1) AND key<>$2`, [name.trim(), key])).rows.length) throw new RoleError(`There is already a role called ${name.trim()}.`);
  await db.query(`UPDATE role SET name=$2, description=$3 WHERE key=$1`, [key, name.trim(), description?.trim() || null]);
  await log(db, by, 'role_renamed', 'role', key, { from: cur, to: { name: name.trim(), description } });
}

/** Retire (or bring back) a role. People keep it on record but get nothing from it while it is retired. */
export async function setRoleRetired(db: Db, by: string | null, key: string, retired: boolean): Promise<void> {
  if (key === 'admin' && retired) throw new RoleError('The Admin role cannot be retired.');
  await db.transaction(async (tx) => {
    const r = await tx.query(`UPDATE role SET retired_at = ${retired ? 'now()' : 'NULL'} WHERE key=$1`, [key]);
    if (!r.affectedRows) throw new RoleError('Unknown role.');
    await keepAnAdmin(tx);
    await log(tx, by, retired ? 'role_retired' : 'role_restored', 'role', key, {});
  });
}

/** Give a person exactly these roles. */
export async function setUserRoles(db: Db, by: string | null, userId: string, roles: string[]): Promise<void> {
  const want = [...new Set(roles)];
  await db.transaction(async (tx) => {
    const known = (await tx.query<{ key: string }>(`SELECT key FROM role`)).rows.map((r) => r.key);
    for (const k of want) if (!known.includes(k)) throw new RoleError(`Unknown role ${k}.`);
    const before = (await tx.query<{ role_key: string }>(`SELECT role_key FROM user_role WHERE user_id=$1 ORDER BY role_key`, [userId])).rows.map((r) => r.role_key);
    if (!(await tx.query(`SELECT 1 FROM app_user WHERE id=$1`, [userId])).rows.length) throw new RoleError('Unknown user.');
    if (JSON.stringify(before) === JSON.stringify([...want].sort())) return;
    await tx.query(`DELETE FROM user_role WHERE user_id=$1`, [userId]);
    for (const k of want) await tx.query(`INSERT INTO user_role (user_id,role_key) VALUES ($1,$2)`, [userId, k]);
    await keepAnAdmin(tx);
    await log(tx, by, 'user_roles_changed', 'user', userId, { from: before, to: [...want].sort() });
  });
}

export { keepAnAdmin, BUILTIN_ROLES };
