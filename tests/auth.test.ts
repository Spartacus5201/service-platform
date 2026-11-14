import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { hashPassword, verifyPassword, createUser, authenticate, changePassword, can, canOwn, parseCredentialsMd } from '../src/auth/auth';

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong password here', a)).toBe(false);
    expect(a).not.toContain('correct');
  });
  it('rejects short passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow();
  });
});

describe('login', () => {
  it('authenticates, forces a first-login change, then clears the flag', async () => {
    const db = await openDb();
    await createUser(db, { email: 'Office@Example.test', name: 'Office One', role: 'office', password: 'temporary-pass-1' });
    expect(await authenticate(db, 'office@example.test', 'nope-nope-nope')).toBeNull();
    const s = await authenticate(db, ' OFFICE@example.test ', 'temporary-pass-1');
    expect(s).toMatchObject({ roles: expect.arrayContaining(['coordinator', 'billing']), mustChangePassword: true });
    expect(await changePassword(db, s!.userId, 'wrong-current-pw', 'a-new-password-2')).toBe(false);
    expect(await changePassword(db, s!.userId, 'temporary-pass-1', 'a-new-password-2')).toBe(true);
    expect(await authenticate(db, 'office@example.test', 'temporary-pass-1')).toBeNull();
    expect(await authenticate(db, 'office@example.test', 'a-new-password-2')).toMatchObject({ mustChangePassword: false });
  });
  it('unknown users fail the same way and are logged', async () => {
    const db = await openDb();
    expect(await authenticate(db, 'nobody@example.test', 'whatever-password')).toBeNull();
    const n = await db.query<{ n: string }>(`SELECT count(*)::text n FROM audit_log WHERE action='login_failed'`);
    expect(n.rows[0].n).toBe('1');
  });
  it('deactivated users cannot sign in', async () => {
    const db = await openDb();
    const id = await createUser(db, { email: 'a@example.test', name: 'A', role: 'office', password: 'temporary-pass-1' });
    await db.query(`UPDATE app_user SET active=false WHERE id=$1`, [id]);
    expect(await authenticate(db, 'a@example.test', 'temporary-pass-1')).toBeNull();
  });
});

describe('permissions', () => {
  it('technicians never see prices; managers do; old roles map onto the new ones', async () => {
    const { openDb } = await import('../src/db');
    const { loadAccess } = await import('../src/auth/auth');
    const db = await openDb();
    const tech = await loadAccess(db, await createUser(db, { email: 't@x.io', name: 'T', role: 'technician', password: 'Password-1234' }));
    expect(can(tech, 'price.view')).toBe(false); expect(can(tech, 'visit.record')).toBe(false); expect(canOwn(tech, 'visit.record')).toBe(true);
    const office = await loadAccess(db, await createUser(db, { email: 'o@x.io', name: 'O', role: 'office', password: 'Password-1234' }));
    expect(office.roles.sort()).toEqual(['billing', 'coordinator']);
    expect(can(office, 'price.edit')).toBe(true); expect(can(office, 'users.manage')).toBe(false);
    const admin = await loadAccess(db, await createUser(db, { email: 'a@x.io', name: 'A', role: 'admin', password: 'Password-1234' }));
    expect(admin.roles.sort()).toEqual(['admin', 'manager']); expect(can(admin, 'users.manage')).toBe(true); expect(can(admin, 'service.correct')).toBe(true);
  }, 60000);
});

describe('credentials file', () => {
  it('parses a markdown table and ignores everything else', () => {
    const md = `# Credentials\n\n| email | name | role | temp password |\n|---|---|---|---|\n| a@example.test | Alex | admin | temp-pass-0001 |\n| b@example.test | Bo | office | temp-pass-0002 |\n`;
    expect(parseCredentialsMd(md)).toEqual([
      { email: 'a@example.test', name: 'Alex', role: 'admin', password: 'temp-pass-0001' },
      { email: 'b@example.test', name: 'Bo', role: 'office', password: 'temp-pass-0002' },
    ]);
  });
  it('rejects unknown roles', () => {
    expect(() => parseCredentialsMd('| a@example.test | A | boss | pw |')).toThrow(/Unknown role/);
  });
});
