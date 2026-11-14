import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { createUser, loadAccess, can, canOwn } from '../src/auth/auth';
import { DEFAULT_GRID, PERMISSIONS, BUILTIN_ROLES } from '../src/auth/permissions';
import { listRoles, saveRolePermissions, restoreDefaults, addRole, setRoleRetired, setUserRoles, RoleError } from '../src/admin/roles';
import { addUser, setActive } from '../src/admin/admin';

const fresh = async () => {
  const db = await openDb();
  const admin = await createUser(db, { email: 'a@x.io', name: 'A', roles: ['admin'], password: 'Password-1234', mustChangePassword: false });
  return { db, admin };
};

describe('roles and permissions', () => {
  it('the database starts with the default grid from the code', async () => {
    const { db } = await fresh();
    const roles = await listRoles(db);
    expect(roles.map((r) => r.key)).toEqual(BUILTIN_ROLES.map((r) => r.key));
    for (const r of roles) expect(r.perms).toEqual(DEFAULT_GRID[r.key]);
    // every permission the grid names exists, and only own-capable ones are ever "own"
    for (const g of Object.values(DEFAULT_GRID)) for (const [k, v] of Object.entries(g)) {
      const p = PERMISSIONS.find((x) => x.key === k)!; expect(p).toBeDefined();
      if (v === 'own') expect('own' in p && p.own).toBe(true);
    }
  }, 60000);

  it('a person with several roles gets everything they allow; "own" is not "all"', async () => {
    const { db } = await fresh();
    const id = await createUser(db, { email: 's@x.io', name: 'S', roles: ['scheduler', 'technician'], password: 'Password-1234' });
    const a = await loadAccess(db, id);
    expect(a.roles.sort()).toEqual(['scheduler', 'technician']);
    expect(a.perms['visit.record']).toBe('all');                 // scheduler's "all" beats technician's "own"
    const t = await loadAccess(db, await createUser(db, { email: 't@x.io', name: 'T', roles: ['technician'], password: 'Password-1234' }));
    expect([can(t, 'job.view'), canOwn(t, 'job.view'), can(t, 'price.view')]).toEqual([false, true, false]);
    const b = await loadAccess(db, await createUser(db, { email: 'b@x.io', name: 'B', roles: ['billing'], password: 'Password-1234' }));
    expect([can(b, 'invoice.manage'), can(b, 'document.draft'), can(b, 'job.manage')]).toEqual([true, false, false]);
  }, 60000);

  it('changes are logged, can be restored to defaults, and take effect at once', async () => {
    const { db, admin } = await fresh();
    const t = await createUser(db, { email: 't@x.io', name: 'T', roles: ['technician'], password: 'Password-1234' });
    expect(await saveRolePermissions(db, admin, 'technician', { ...DEFAULT_GRID.technician, 'price.view': 'all' })).toBe(1);
    expect(can(await loadAccess(db, t), 'price.view')).toBe(true);
    const log = (await db.query<{ detail: Record<string, unknown> }>(`SELECT detail FROM audit_log WHERE action='role_permissions_changed'`)).rows;
    expect(log[0].detail).toEqual({ 'price.view': { from: null, to: 'all' } });
    expect(await restoreDefaults(db, admin, 'technician')).toBe(1);
    expect(can(await loadAccess(db, t), 'price.view')).toBe(false);
  }, 60000);

  it('refuses changes that would lock everyone out, and what cannot be "own"', async () => {
    const { db, admin } = await fresh();
    await expect(saveRolePermissions(db, admin, 'admin', { ...DEFAULT_GRID.admin, 'users.manage': null })).rejects.toThrow(/always keeps/);
    await expect(setRoleRetired(db, admin, 'admin', true)).rejects.toThrow(/cannot be retired/);
    await expect(setUserRoles(db, admin, admin, ['manager'])).rejects.toBeInstanceOf(RoleError);
    await expect(setActive(db, admin, admin, false)).rejects.toThrow(/nobody who can manage users/);
    await expect(saveRolePermissions(db, admin, 'billing', { 'price.edit': 'own' })).rejects.toThrow(/own records/);
    const second = await addUser(db, admin, { email: 'b@x.io', name: 'B', roles: ['admin'] });
    await setUserRoles(db, admin, admin, ['manager']);                         // fine: B can still manage users and roles
    expect((await loadAccess(db, second.id)).perms['roles.manage']).toBe('all');
  }, 60000);

  it('a new role can copy another, be renamed and retired', async () => {
    const { db, admin } = await fresh();
    const key = await addRole(db, admin, { name: 'Field Lead', copyFrom: 'technician' });
    expect(key).toBe('field_lead');
    expect((await listRoles(db)).find((r) => r.key === key)!.perms).toEqual(DEFAULT_GRID.technician);
    await expect(addRole(db, admin, { name: 'field lead' })).rejects.toThrow(/already/);
    const u = await createUser(db, { email: 'f@x.io', name: 'F', roles: [key], password: 'Password-1234' });
    expect(canOwn(await loadAccess(db, u), 'visit.record')).toBe(true);
    await setRoleRetired(db, admin, key, true);
    expect(await loadAccess(db, u)).toEqual({ roles: [], perms: {} });
    await expect(restoreDefaults(db, admin, key)).rejects.toThrow(/built-in/);
  }, 60000);

  it('moves today\'s users onto the new roles without losing anything', async () => {
    const { db } = await fresh();
    // users created the old way (role column only) and then migration 027's mapping run again
    for (const [email, role] of [['o@x.io', 'office'], ['c@x.io', 'coordinator']] as const)
      await db.query(`INSERT INTO app_user (email,name,role,password_hash) VALUES ($1,'x',$2,'x')`, [email, role]);
    await db.query(`INSERT INTO user_role (user_id, role_key) SELECT u.id, m.role_key FROM app_user u
      JOIN (VALUES ('admin','admin'),('admin','manager'),('office','coordinator'),('office','billing'),('coordinator','coordinator'),('technician','technician')) m(old, role_key) ON m.old=u.role
      WHERE NOT EXISTS (SELECT 1 FROM user_role x WHERE x.user_id=u.id)`);
    const roles = async (email: string) => (await db.query<{ k: string }>(`SELECT role_key k FROM user_role ur JOIN app_user u ON u.id=ur.user_id WHERE u.email=$1 ORDER BY 1`, [email])).rows.map((r) => r.k);
    expect(await roles('o@x.io')).toEqual(['billing', 'coordinator']);
    expect(await roles('c@x.io')).toEqual(['coordinator']);
  }, 60000);
});
