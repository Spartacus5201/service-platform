import { describe, it, expect } from 'vitest';
import { world } from './helpers';
import { addUser, saveSettings, listActivity } from '../src/admin/admin';
import { createUser } from '../src/auth/auth';
import { listProperties } from '../src/server/queries';

describe('activity log and property list', () => {
  it('lists changes newest first, filters, and names the person', async () => {
    const { db } = await world();
    const me = await createUser(db, { email: 'a@x.io', name: 'Ann', role: 'admin', password: 'Password-1234', mustChangePassword: false });
    await addUser(db, me, { email: 'b@x.io', name: 'Bob', role: 'office' });
    await saveSettings(db, me, { post_audit_days: '9' });
    const all = await listActivity(db);
    expect(all.rows[0]).toMatchObject({ who: 'Ann', action: 'setting_changed', label: 'Changed a setting' });
    expect(all.rows[0].detail).toContain('to: 9');
    const only = await listActivity(db, { action: 'setting_changed', userId: me });
    expect(only.rows.every((r) => r.action === 'setting_changed')).toBe(true);
    expect(all.actions).toContain('setting_changed');
    const page = await listActivity(db, { limit: 1 });
    expect(page.more).toBe(true);
    const older = await listActivity(db, { before: page.rows[0].id, limit: 1 });
    expect(Number(older.rows[0].id)).toBeLessThan(Number(page.rows[0].id));
  }, 60000);

  it('filters properties and shows next audit due only when an interval is set', async () => {
    const { db } = await world();
    expect((await listProperties(db))[0].due).toBeNull();
    const name = (await listProperties(db))[0].name;
    expect(await listProperties(db, { q: name.slice(0, 4).toLowerCase() })).toHaveLength(1);
    expect(await listProperties(db, { q: 'zzzz-none' })).toHaveLength(0);
    const me = await createUser(db, { email: 'a@x.io', name: 'Ann', role: 'admin', password: 'Password-1234', mustChangePassword: false });
    await saveSettings(db, me, { audit_interval_days: '365' });
    const p = (await listProperties(db))[0];
    if (p.last_audit) expect(p.due).toBe(new Date(Date.parse(p.last_audit) + 365 * 86400000).toISOString().slice(0, 10));
  }, 60000);
});
