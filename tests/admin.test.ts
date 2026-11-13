import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db';
import { authenticate, createUser } from '../src/auth/auth';
import { addUser, resetPassword, setRole, setActive, saveSettings, getSettings, listUsers, tempPassword, AdminError, rawFileStats } from '../src/admin/admin';
import { loadSettings } from '../src/queries/audit';
import { importParsed, purgeExpiredImports } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { synthUnits, synthAutoAudit, SYNTH_CLASS_ID } from '../src/dev/synthetic';

describe('admin', () => {
  let db: Awaited<ReturnType<typeof openDb>>; let admin: string;
  beforeEach(async () => { db = await openDb(); admin = await createUser(db, { email: 'a@x.io', name: 'A', role: 'admin', password: 'Password-1234', mustChangePassword: false }); }, 30000);

  it('creates a user whose temporary password works once and must be changed', async () => {
    const r = await addUser(db, admin, { email: ' New@X.io ', name: 'New', role: 'technician' });
    expect(r.password).toHaveLength(14);
    const s = await authenticate(db, 'new@x.io', r.password);
    expect(s).toMatchObject({ role: 'technician', mustChangePassword: true });
  });
  it('rejects bad input and duplicates', async () => {
    await expect(addUser(db, admin, { email: 'nope', name: 'x', role: 'office' })).rejects.toBeInstanceOf(AdminError);
    await expect(addUser(db, admin, { email: 'a@x.io', name: 'x', role: 'office' })).rejects.toThrow(/already/);
    await expect(addUser(db, admin, { email: 'b@x.io', name: ' ', role: 'office' })).rejects.toThrow(/name/);
  });
  it('resets a password and forces a change', async () => {
    const u = await addUser(db, admin, { email: 'b@x.io', name: 'B', role: 'office' });
    const p = await resetPassword(db, admin, u.id);
    expect(await authenticate(db, 'b@x.io', u.password)).toBeNull();
    expect((await authenticate(db, 'b@x.io', p))?.mustChangePassword).toBe(true);
  });
  it('never leaves the system without an active admin', async () => {
    await expect(setRole(db, admin, admin, 'office')).rejects.toThrow(/at least one/);
    await expect(setActive(db, admin, admin, false)).rejects.toThrow(/at least one/);
    const second = await addUser(db, admin, { email: 'c@x.io', name: 'C', role: 'admin' });
    await setRole(db, admin, admin, 'office');                                  // fine now: another admin exists
    await expect(setActive(db, admin, second.id, false)).rejects.toThrow(/at least one/);
  });
  it('deactivated users cannot sign in', async () => {
    const u = await addUser(db, admin, { email: 'd@x.io', name: 'D', role: 'office' });
    await setActive(db, admin, u.id, false);
    expect(await authenticate(db, 'd@x.io', u.password)).toBeNull();
    expect((await listUsers(db)).find((x) => x.id === u.id)?.active).toBe(false);
    await setActive(db, admin, u.id, true);
    expect(await authenticate(db, 'd@x.io', u.password)).not.toBeNull();
  });
  it('validates and applies settings, and the rules read them', async () => {
    await expect(saveSettings(db, admin, { int_read_threshold: '0' })).rejects.toThrow(/whole number/);
    await expect(saveSettings(db, admin, { quote_valid_days: '2.5' })).rejects.toThrow(/whole number/);
    expect(await saveSettings(db, admin, { int_read_threshold: '12', warranty_months_service: '6', quote_valid_days: '30' })).toEqual(['INT: maximum reads', 'Service warranty']);
    expect((await getSettings(db)).int_read_threshold).toBe(12);
    const l = await loadSettings(db);
    expect(l.audit.intReadThreshold).toBe(12); expect(l.warranty.serviceMonths).toBe(6);
    expect((await db.query(`SELECT 1 FROM audit_log WHERE action='setting_changed'`)).rows).toHaveLength(2);
  });
  it('retention setting controls purge_after and purge deletes only expired raw files', async () => {
    await saveSettings(db, admin, { raw_import_retention_days: '7' });
    const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'T') RETURNING id`, [SYNTH_CLASS_ID])).rows[0].id;
    const r = await importParsed(db, pid, parseAutoAudit(synthAutoAudit(synthUnits())), { createMissing: true, filename: 'a.xlsx', fileBytes: new Uint8Array([1, 2, 3]) });
    const days = (await db.query<{ d: number }>(`SELECT (purge_after - current_date) d FROM import_batch WHERE id=$1`, [r.batchId])).rows[0].d;
    expect(days).toBe(7);
    expect((await rawFileStats(db)).kept).toBe(1);
    expect(await purgeExpiredImports(db)).toBe(0);
    expect(await purgeExpiredImports(db, '2099-01-01')).toBe(1);
    expect((await rawFileStats(db)).kept).toBe(0);
  });
  it('temp passwords have no look-alike characters', () => { for (let i = 0; i < 50; i++) expect(tempPassword()).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{14}$/); });
});
