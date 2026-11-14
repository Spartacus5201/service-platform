// Setup export and import: the whole setup moves to another server unchanged, an import is previewed first,
// a snapshot makes it undoable, and history explains past prices and rules.
import { describe, it, expect, beforeAll } from 'vitest';
import { world, count, type World } from './helpers';
import { openDb, type Db } from '../src/db';
import { createUser } from '../src/auth/auth';
import { exportSetup, importSetup, parseSetup, previewSetup, getSnapshot, listSnapshots } from '../src/admin/setup';
import { saveListItem } from '../src/lists/lists';
import { DEFAULT_RULES } from '../src/rules/audit';
import { loadRules, rulesOn, saveDraft, saveRules, testRules, getDraft } from '../src/rules/table';
import { getSystemNotes, saveSystemNotes, propertyPricesOn, propertyPriceHistory } from '../src/documents/systemnotes';

let a: World; let b: Db; let me = '';
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  a = await world();
  me = await createUser(a.db, { email: 'm@t.io', name: 'M', roles: ['admin', 'manager'], password: 'Password-1234', mustChangePassword: false });
  // Things people configure on server A.
  await saveListItem(a.db, me, { list: 'job_source', label: 'Walk-in', active: true });
  await saveListItem(a.db, me, { list: 'audit_code', code: 'NT', label: 'No signal', active: true });
  await a.db.query(`INSERT INTO setting (key,value) VALUES ('labor_rate','95') ON CONFLICT (key) DO UPDATE SET value='95'`);
  const part = (await a.db.query<{ id: string }>(`INSERT INTO catalog_item (name,kind,component,price,effective_from) VALUES ('TR4 transmitter','part','transmitter',80,'2026-01-01') RETURNING id`)).rows[0].id;
  const tr4 = (await a.db.query<{ id: string }>(`SELECT id FROM equipment_model WHERE model='TR4'`)).rows[0].id;
  await a.db.query(`UPDATE equipment_model SET part_item_id=$1 WHERE id=$2`, [part, tr4]);
  await saveDraft(a.db, me, { ...DEFAULT_RULES, NEG: { ...DEFAULT_RULES.NEG, occupied: { action: 'Needs Service', owner: null, reason: 'Negative usage: check the meter' } } });
  await saveRules(a.db, me, await testRules(a.db, (await getDraft(a.db, me))!, { asOf: day(0) }));
  await a.db.query(`UPDATE role_permission SET scope='all' WHERE role_key='technician' AND permission='job.view'`);
  b = await openDb();
  // A real second server made its starter equipment with its own ids.
  const { readFileSync } = await import('node:fs');
  await b.exec(`DELETE FROM equipment_model; ${readFileSync('db/migrations/023_starter_equipment.sql', 'utf8')}`);
}, 120000);

describe('setup file', () => {
  it('exports every section, with no users, secrets or data', async () => {
    const f = await exportSetup(a.db);
    expect(Object.keys(f.sections)).toEqual(['settings', 'lists', 'services', 'catalog', 'equipment', 'rules', 'layouts', 'clauses', 'roles', 'permissions']);
    const text = JSON.stringify(f);
    expect(text).not.toMatch(/password|setup_code_hash|Test Property|m@t\.io/);
    expect(f.sections.settings.find((r) => r.key === 'labor_rate')?.value).toBe(95);
  });

  it('moves to a fresh server unchanged: preview, import, and a second import changes nothing', async () => {
    const f = parseSetup(JSON.stringify(await exportSetup(a.db)));
    const p = await previewSetup(b, f);
    const sec = (k: string) => p.sections.find((s) => s.key === k)!;
    expect(sec('lists').added.length).toBe(2);
    expect(sec('catalog').added).toEqual(['TR4 transmitter']);
    expect(sec('rules').added).toEqual(['NEG']);
    expect([sec('equipment').added, sec('equipment').changed, sec('equipment').unchanged]).toEqual([[], ['Next Century TR4'], 1]);
    expect(sec('settings').changed).toEqual(['labor_rate']);
    expect(sec('permissions').changed.length).toBe(1);
    await importSetup(b, null, f);
    const again = await previewSetup(b, f);
    expect(again.total).toBe(0);
    expect(JSON.stringify((await exportSetup(b)).sections)).toBe(JSON.stringify(f.sections));
    expect((await loadRules(b)).NEG.occupied.action).toBe('Needs Service');
    const tr201 = (await b.query<{ by: string }>(`SELECT r.model by FROM equipment_model m JOIN equipment_model r ON r.id=m.replaced_by WHERE m.model='TR201'`)).rows[0];
    expect(tr201.by).toBe('TR4');
    expect(await count(b, `SELECT count(*) n FROM equipment_model`)).toBe(2);
  });

  it('a setup import can be undone from its snapshot', async () => {
    const before = await exportSetup(b);
    const f = await exportSetup(a.db);
    f.sections.settings = f.sections.settings.map((r) => (r.key === 'labor_rate' ? { ...r, value: 120 } : r));
    f.sections.rules = [];                                          // the file says: built-in rules everywhere
    await importSetup(b, null, f);
    expect((await loadRules(b)).NEG).toEqual(DEFAULT_RULES.NEG);
    const snap = (await listSnapshots(b))[0];
    await importSetup(b, null, (await getSnapshot(b, snap.id))!, 'Undo');
    expect(JSON.stringify((await exportSetup(b)).sections)).toBe(JSON.stringify(before.sections));
    expect(await count(b, `SELECT count(*) n FROM audit_log WHERE action='setup_imported'`)).toBe(3);
  });

  it('the Admin role keeps user and role management whatever the file says', async () => {
    const f = await exportSetup(a.db);
    f.sections.permissions = f.sections.permissions.filter((r) => !(r.role_key === 'admin' && r.permission === 'users.manage'));
    await importSetup(b, null, f);
    expect(await count(b, `SELECT count(*) n FROM role_permission WHERE role_key='admin' AND permission='users.manage'`)).toBe(1);
  });

  it('refuses files that are not setup files', () => {
    expect(() => parseSetup('hello')).toThrow(/not JSON/);
    expect(() => parseSetup('{"app":"other","sections":{}}')).toThrow(/not a Service Platform setup file/);
    expect(() => parseSetup('{"app":"service-platform","format":99,"sections":{}}')).toThrow(/format 99/);
    expect(() => parseSetup('{"app":"service-platform","format":1,"sections":{"users":[]}}')).toThrow(/Unknown section "users"/);
  });
});

describe('history', () => {
  it('rules in force on a date', async () => {
    expect((await rulesOn(a.db, day(-1))).NEG).toEqual(DEFAULT_RULES.NEG);
    expect((await rulesOn(a.db, day(0))).NEG.occupied.action).toBe('Needs Service');
  });
  it('property prices on a date', async () => {
    const notes = await getSystemNotes(a.db, a.pid);
    await saveSystemNotes(a.db, a.pid, notes, { Labor: 90 }, false, me);
    await saveSystemNotes(a.db, a.pid, notes, { Labor: 90, Meter: 150 }, false, me);
    expect(await propertyPricesOn(a.db, a.pid, day(-1))).toEqual({});
    expect(await propertyPricesOn(a.db, a.pid, day(0))).toEqual({ Labor: 90, Meter: 150 });
    expect((await propertyPriceHistory(a.db, a.pid)).map((h) => [h.item, h.price])).toEqual([['Meter', 150], ['Labor', 90]]);
  });
});
