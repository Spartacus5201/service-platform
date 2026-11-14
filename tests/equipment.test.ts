import { describe, it, expect } from 'vitest';
import { world } from './helpers';
import { saveModel, listModels, findModel, inField, replacementFor, batteryForModel, currentPart, catalogOptions, suggestParts, EquipmentError } from '../src/equipment/registry';
import { batteryFor } from '../src/service/battery';
import { createDocument } from '../src/documents/build';
import { matchService, saveService, listServices, ServiceListError } from '../src/lists/services';
import { utilityToServiceCode } from '../src/parsers/common';
import type { Db } from '../src/db';

async function catalog(db: Db) {
  const add = async (name: string, component: string, price: number, partNumber: string | null, notes: string | null = null, on = '2026-01-01') =>
    (await db.query<{ id: string }>(`INSERT INTO catalog_item (name,kind,component,price,effective_from,part_type,part_number,notes,source) VALUES ($1,'part',$2,$3,$4,$5,$6,$7,'inventory') RETURNING id`,
      [name, component, price, on, component === 'battery' ? 'Battery' : 'Transmitter', partNumber, notes])).rows[0].id;
  return {
    tr4: await add('Next Century Transciever', 'transmitter', 66.5, 'NC-TR4'),
    tr4x: await add('Next Century Transciever for OUTDOOR applications', 'transmitter', 117.25, 'NC-TR4-X'),
    bat: await add('CR18505 Transmitter Batteries for TR4', 'battery', 7.77, 'NC-BAT4-25', '25 pack (TR4, RR4, TR4X, & RR4TR)'),
    add,
  };
}

describe('service codes', () => {
  it('reads report words exactly, and the new codes are on the list', async () => {
    expect(['All Water', 'hot water', 'Chilled Water', 'HVAC', 'WA', 'Natural Gas'].map((x) => matchService(x))).toEqual(['WS', 'HW', 'CW', 'HV', 'WA', 'GS']);
    expect(matchService('Irrigation')).toBeNull();
    expect(utilityToServiceCode('Hot Water')).toBe('HW');
    expect(utilityToServiceCode('Irrigation water')).toBeNull();      // never guessed: the row is reported
    expect(utilityToServiceCode(null)).toBe('WS');                     // a blank utility is water
    const { db } = await world();
    expect((await listServices(db)).map((s) => s.code)).toEqual(['WS', 'GS', 'EL', 'HW', 'CW', 'HV', 'WA']);
  }, 60000);
  it('adds and changes a code, and one word can only mean one service', async () => {
    const { db } = await world();
    expect(await saveService(db, null, { code: 'st', name: 'Steam', words: ['steam', 'Steam Heat'], active: true })).toBe('added');
    expect(matchService('steam heat', await listServices(db))).toBe('ST');
    await expect(saveService(db, null, { code: 'ST', name: 'Steam', words: ['hot water'], active: true })).rejects.toThrow(/already means HW/);
    await expect(saveService(db, null, { code: 'TOO-LONG', name: 'x', words: [], active: true })).rejects.toBeInstanceOf(ServiceListError);
    expect(await saveService(db, null, { code: 'ST', name: 'Steam', words: ['steam heat', 'steam'], active: false })).toBe('changed');
    expect((await listServices(db)).some((s) => s.code === 'ST')).toBe(false);
    expect(matchService('steam', await listServices(db, { includeRetired: true }))).toBe('ST');
  }, 60000);
});

const fresh = async (db: Db) => { await db.query(`UPDATE equipment_model SET replaced_by=NULL`); await db.query(`DELETE FROM equipment_model`); };

describe('equipment registry', () => {
  it('ships with TR4 current and TR201 obsolete, replaced by TR4', async () => {
    const { db } = await world();
    const all = await listModels(db);
    expect(findModel(all, 'TR201')).toMatchObject({ status: 'obsolete', replacedByLabel: 'Next Century TR4' });
    expect(findModel(all, 'nc-tr4')).toMatchObject({ model: 'TR4', status: 'current' });
  }, 60000);
  it('never adds a battery to the bring list for a new transmitter (it comes with one)', async () => {
    const { bringList } = await import('../src/documents/systemnotes');
    const notes = { equipment: [], transmitterDevice: 'Next Century TR4', meterDevice: null } as unknown as Parameters<typeof bringList>[0];
    expect(bringList(notes, [{ component: 'transmitter', quantity: 2, include: true }])).toEqual([{ qty: 2, device: 'Next Century TR4' }]);
  });
  it('validates models, codes and replacement chains', async () => {
    const { db } = await world(); await fresh(db);
    const tr4 = await saveModel(db, null, { manufacturer: 'Next Century', model: 'TR4', kind: 'transmitter', aliases: ['NC-TR4'] });
    await expect(saveModel(db, null, { manufacturer: 'Other', model: 'nc tr4', kind: 'transmitter' })).rejects.toThrow(/already means Next Century TR4/);
    await expect(saveModel(db, null, { manufacturer: 'Next Century', model: 'tr4', kind: 'transmitter' })).rejects.toThrow(/already/);
    const old = await saveModel(db, null, { manufacturer: 'Next Century', model: 'TR201', kind: 'transmitter', status: 'obsolete', replacedBy: tr4 });
    await expect(saveModel(db, null, { manufacturer: 'Next Century', model: 'TR4', kind: 'transmitter', replacedBy: old }, tr4)).rejects.toThrow(/loop/);
    await expect(saveModel(db, null, { manufacturer: 'X', model: 'Y', kind: 'toaster' })).rejects.toBeInstanceOf(EquipmentError);
    expect(findModel(await listModels(db), 'tr-201')?.id).toBe(old);
    const log = await db.query(`SELECT action FROM audit_log WHERE entity='equipment_model'`);
    expect(log.rows).toHaveLength(2);
  }, 60000);

  it('prices batteries and replacements from the model, following obsolete models to their replacement', async () => {
    const { db, ep } = await world(); await fresh(db);
    await db.query(`INSERT INTO catalog_item (name,kind,component,price,effective_from) VALUES ('Transmitter','part','transmitter',85.00,'2026-01-01'),('Labor, per visit','labor',NULL,125.00,'2026-01-01')`);
    const c = await catalog(db);
    const tr4 = await saveModel(db, null, { manufacturer: 'Next Century', model: 'TR4', kind: 'transmitter', partItemId: c.tr4, batteryItemId: c.bat });
    await saveModel(db, null, { manufacturer: 'Next Century', model: 'TR201', kind: 'transmitter', status: 'obsolete', replacedBy: tr4 });
    // unit 102 is NT; its transmitter is reported as a TR201
    await db.query(`UPDATE device SET model='TR201' WHERE hardware_id='AMR1'`);
    const rep = await replacementFor(db, await ep('102'), 'transmitter', '2026-11-13');
    expect(rep).toMatchObject({ model: { model: 'TR201' }, quoted: { model: 'TR4' }, part: { price: 66.5 }, note: 'TR201 is obsolete; replace with TR4' });

    // A later price change in the catalog is picked up without touching the model.
    await c.add('Next Century Transciever', 'transmitter', 70, 'NC-TR4', null, '2026-06-01');
    expect((await currentPart(db, c.tr4, '2026-11-13'))!.price).toBe(70);
    expect((await currentPart(db, c.tr4, '2026-03-01'))!.price).toBe(66.5);

    expect((await batteryForModel(db, 'TR4', '2026-11-13'))!.price).toBe(7.77);
    expect((await batteryFor(db, 'TR4', '2026-11-13')).price).toBe(7.77);
    expect((await batteryFor(db, 'TR201', '2026-11-13')).price).toBe(9.1);   // TR201 has no battery set: default

    const { batchId, pid } = await (async () => { const w = await db.query<{ id: string; property_id: string }>(`SELECT id, property_id FROM import_batch ORDER BY imported_at DESC LIMIT 1`); return { batchId: w.rows[0].id, pid: w.rows[0].property_id }; })();
    const d = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: '2026-11-13', fromAuditBatch: batchId });
    const line = (await db.query<{ description: string; unit_price: string }>(
      `SELECT l.description, l.unit_price::text FROM document_line l WHERE l.version_id=$1 AND l.endpoint_id=$2`, [d.versionId, await ep('102')])).rows[0];
    expect(line.description).toContain('TR201 is obsolete; replace with TR4');
    expect(Number(line.unit_price)).toBe(70);

    const field = await inField(db);
    expect(field.find((f) => f.code === 'TR201')).toMatchObject({ devices: 1, model: { status: 'obsolete' } });
  }, 60000);

  it('suggests catalog parts that name the model as a whole word', async () => {
    const { db } = await world();
    const c = await catalog(db);
    const bats = suggestParts(await catalogOptions(db, ['battery']), ['TR4']);
    expect(bats.map((b) => b.id)).toEqual([c.bat]);
    const parts = suggestParts(await catalogOptions(db, ['transmitter']), ['TR4']);
    expect(parts.map((p) => p.id)).toEqual([c.tr4, c.tr4x]);          // NC-TR4 before NC-TR4-X (fewer extra words)
    expect(suggestParts(await catalogOptions(db, ['battery']), ['TR201'])).toEqual([]);
    expect(suggestParts(await catalogOptions(db, ['transmitter']), ['TR4X']).map((p) => p.id)).toEqual([c.tr4x]);   // vendor prefix on the part number
    expect(suggestParts(await catalogOptions(db, ['battery']), ['TR4X']).map((p) => p.id)).toEqual([c.bat]);          // named in the notes
    const poly = await c.add('Minomess 130  Poly', 'meter', 37.98, '137145');
    await c.add('Minomess 130  Brass', 'meter', 37.98, '137142');
    expect(suggestParts(await catalogOptions(db, ['meter']), ['Minomess 130 Poly']).map((p) => p.id)).toEqual([poly]);   // every word must match
  }, 60000);
});
