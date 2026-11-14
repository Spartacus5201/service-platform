import { describe, it, expect } from 'vitest';
import { world, count } from './helpers';
import { createUpload, wizardView, saveState, chooseTarget, commitWizard, getUpload, listLayouts, retireLayout, guessHeaderRow, WizardError } from '../src/importer/wizard';
import { synthAmrStatus, synthUnits } from '../src/dev/synthetic';

const enc = (t: string) => new TextEncoder().encode(t);
const vendor = (rows: string[][], head = 'Apt,Bldg,Radio,Pct,Utility,Last Heard,Reading') =>
  enc(['Acme Metering export', 'Printed 11/13/2026', '', head, ...rows.map((r) => r.join(','))].join('\n') + '\n');
const ROWS = [['101', '1', 'AMR0', '80', 'Water', '2026-11-12T08:00:00Z', '1000'], ['102', '1', 'AMR1', '20', 'Water', '2026-11-12T08:00:00Z', '2000']];

async function mapNew(db: Awaited<ReturnType<typeof world>>['db'], id: string) {
  const v = await wizardView(db, id);
  const header = v.columns.map((c) => c.header);
  let st = chooseTarget(v.state, header, { target: 'devices' });
  expect(st.overrides.columns).toMatchObject({ unit: 1, building: 2, service: 5, last_check_in: 6, read: 7 });
  expect(st.overrides.columns!.hardware_id).toBeUndefined();          // "Radio" is not guessed
  st = { ...st, suggested: false, overrides: { ...st.overrides, columns: { ...st.overrides.columns, hardware_id: 3, battery_level: 4 } } };
  await saveState(db, id, st);
  return wizardView(db, id);
}

describe('import wizard', () => {
  it('maps an unknown file, imports it, and recognises the next one by itself', async () => {
    const { db, pid } = await world();
    const up = await createUpload(db, pid, 'acme.csv', vendor(ROWS), null);
    expect(up.matched).toBeNull();
    const v0 = await wizardView(db, up.id);
    expect(v0.headerRow).toBe(3);   // blank lines are not counted
    const v = await mapNew(db, up.id);
    expect(v.preview!.importable).toBe(true);
    expect(v.preview!.sample[0].values).toMatchObject({ unit: '101', hardware_id: 'AMR0', battery_level: 80, service: 'WS' });

    await expect(commitWizard(db, up.id, { userId: null })).rejects.toThrow(/Name this map/);
    const r = await commitWizard(db, up.id, { saveAs: 'Acme radio export', createMissing: true, userId: null });
    expect(r.layout).toMatchObject({ name: 'Acme radio export', version: 1 });
    expect(await count(db, `SELECT count(*) n FROM import_batch WHERE layout_id=$1 AND layout_version=1`, [r.layout.id])).toBe(1);
    expect(await count(db, `SELECT count(*) n FROM device_checkin WHERE battery_level=20`)).toBe(1);
    await expect(getUpload(db, up.id)).rejects.toThrow(/already imported/);

    // Next month's file: same layout, new values. Recognised and importable with no changes.
    const next = await createUpload(db, pid, 'acme-dec.csv', vendor(ROWS.map((x) => x.map((c) => (c === '2026-11-12T08:00:00Z' ? '2026-12-12T08:00:00Z' : c)))), null);
    expect(next.matched).toBe('Acme radio export');
    const nv = await wizardView(db, next.id);
    expect(nv.changed).toBe(false); expect(nv.preview!.importable).toBe(true);
    const r2 = await commitWizard(db, next.id, { userId: null });
    expect(r2.layout).toEqual(r.layout);
  }, 60000);

  it('stops a rejected row until it is read another way or left out with a reason', async () => {
    const { db, pid } = await world();
    const up = await createUpload(db, pid, 'acme.csv', vendor([...ROWS, ['103', '1', 'AMR2', '50', 'Irrigation', '2026-11-12T08:00:00Z', '5']]), null);
    let v = await mapNew(db, up.id);
    expect(v.preview!.importable).toBe(false);
    expect(v.problemValues.service).toEqual([expect.objectContaining({ raw: 'Irrigation', count: 1 })]);
    await saveState(db, up.id, { ...v.state, overrides: { ...v.state.overrides, excludeRows: [6] } });
    await expect(commitWizard(db, up.id, { saveAs: 'Acme', userId: null })).rejects.toThrow(/why/);
    await saveState(db, up.id, { ...v.state, overrides: { ...v.state.overrides, lookups: { service: { Irrigation: 'Water' } } } });
    v = await wizardView(db, up.id);
    expect(v.preview!.importable).toBe(true);
    const r = await commitWizard(db, up.id, { saveAs: 'Acme', createMissing: true, userId: null });
    const saved = (await listLayouts(db)).find((l) => l.id === r.layout.id)!;
    expect(saved.columns.find((c) => c.field === 'service')!.lookup).toEqual({ Irrigation: 'Water' });
  }, 60000);

  it('saves a change to a saved map as a new version, and a retired map is no longer matched', async () => {
    const { db, pid } = await world();
    const a = await createUpload(db, pid, 'acme.csv', vendor(ROWS), null);
    await mapNew(db, a.id);
    const r1 = await commitWizard(db, a.id, { saveAs: 'Acme', createMissing: true, userId: null });
    const b = await createUpload(db, pid, 'acme2.csv', vendor(ROWS.map((x) => [...x.slice(0, 6), '9999'])), null);
    const vb = await wizardView(db, b.id);
    await saveState(db, b.id, { ...vb.state, overrides: { ...vb.state.overrides, columns: { usage: 7, read: null } } });
    const r2 = await commitWizard(db, b.id, { userId: null });
    expect(r2.layout).toEqual({ ...r1.layout, version: 2 });
    expect(await count(db, `SELECT count(*) n FROM import_layout WHERE id=$1`, [r1.layout.id])).toBe(2);
    await retireLayout(db, r1.layout.id, null);
    expect((await createUpload(db, pid, 'acme3.csv', vendor(ROWS), null)).matched).toBeNull();
  }, 60000);

  it('opens a known report on its built-in map and never changes the built-in', async () => {
    const { db, pid } = await world();
    const up = await createUpload(db, pid, 'amr.csv', enc(synthAmrStatus(synthUnits(1, 3))), null);
    expect(up.matched).toBe('Next Century AMR Status Report');
    const v = await wizardView(db, up.id);
    await saveState(db, up.id, { ...v.state, overrides: { ...v.state.overrides, columns: { meter_label: null } } });
    await expect(commitWizard(db, up.id, { userId: null })).rejects.toThrow(/built-in map/);
  }, 60000);

  it('guesses the header row under a title block', () => {
    expect(guessHeaderRow([['Report'], [], ['Unit', 'Building', 'ID'], ['1', '2', '3']])).toBe(3);
    expect(new WizardError('x')).toBeInstanceOf(Error);
  });
});
