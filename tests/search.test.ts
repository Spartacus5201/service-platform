import { describe, it, expect, beforeAll } from 'vitest';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { synthUnits, synthAutoAudit, SYNTH_CLASS_ID } from '../src/dev/synthetic';
import { search, tokens } from '../src/search/search';

describe('search', () => {
  let db: Awaited<ReturnType<typeof openDb>>; let eid: string;
  beforeAll(async () => {
    db = await openDb();
    const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name,address) VALUES ($1,'Synthetic Gardens','1 Synthetic Way') RETURNING id`, [SYNTH_CLASS_ID])).rows[0].id;
    await importParsed(db, pid, parseAutoAudit(synthAutoAudit(synthUnits())), { createMissing: true });
    eid = (await db.query<{ id: string }>(`SELECT e.id FROM endpoint e JOIN unit u ON u.id=e.unit_id LIMIT 1`)).rows[0].id;
    const v = (await db.query<{ id: string }>(`INSERT INTO visit (property_id,visited_on,outcome,technician,salesforce_case,salesforce_work_order,notes) VALUES ($1,'2026-11-01','completed','Tom','500CASE1','08WO1','Tenant said the 100% leak is fixed_now') RETURNING id`, [pid])).rows[0].id;
    await db.query(`INSERT INTO service_event (visit_id,endpoint_id,action,notes) VALUES ($1,$2,'repair','replaced a gasket')`, [v, eid]);
    await db.query(`INSERT INTO document (type,property_id,number,title,salesforce_case) VALUES ('WA',$1,'9900001-261101','Spring work','500CASE9')`, [pid]);
  }, 60000);
  const kinds = (h: { kind: string }[]) => [...new Set(h.map((x) => x.kind))].sort();

  it('splits words and ignores blanks', () => { expect(tokens('  a  b a ')).toEqual(['a', 'b']); });
  it('finds a property by name or ClassID, case-insensitively', async () => {
    expect((await search(db, 'synthetic GARDENS', { includeDocuments: true })).some((h) => h.kind === 'property')).toBe(true);
    expect((await search(db, SYNTH_CLASS_ID, { includeDocuments: true })).some((h) => h.kind === 'property')).toBe(true);
  });
  it('finds a unit by building-unit pair, ignoring leading zeros', async () => {
    const u = (await db.query<{ b: string; n: string }>(`SELECT b.label b, u.current_label n FROM endpoint e JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id WHERE e.id=$1`, [eid])).rows[0];
    const hits = await search(db, `${Number(u.b)}-${Number(u.n)}`, { includeDocuments: true });
    expect(hits.some((h) => h.kind === 'unit' && h.href === `/endpoints/${eid}`)).toBe(true);
  });
  it('finds visit notes, cases and work orders, and requires every word', async () => {
    expect(kinds(await search(db, 'gasket', { includeDocuments: true }))).toContain('service');
    expect((await search(db, '500CASE1', { includeDocuments: true })).some((h) => h.kind === 'service')).toBe(true);
    expect((await search(db, 'gasket tenant', { includeDocuments: true })).length).toBe(1);
    expect(await search(db, 'gasket zebra', { includeDocuments: true })).toEqual([]);
  });
  it('treats % and _ literally', async () => {
    expect((await search(db, '100%', { includeDocuments: true })).some((h) => h.kind === 'service')).toBe(true);
    expect(await search(db, '%%', { includeDocuments: true })).toEqual([]);
    expect(await search(db, 'fixed_now', { includeDocuments: true })).toHaveLength(1);
    expect(await search(db, 'fixedXnow', { includeDocuments: true })).toHaveLength(0);
  });
  it('searches documents only when allowed', async () => {
    expect((await search(db, '500CASE9', { includeDocuments: true })).map((h) => h.kind)).toEqual(['document']);
    expect(await search(db, '500CASE9', { includeDocuments: false })).toEqual([]);
  });
  it('finds a device by hardware ID', async () => {
    const hw = (await db.query<{ h: string }>(`SELECT hardware_id h FROM device WHERE hardware_id IS NOT NULL LIMIT 1`)).rows[0]?.h;
    if (hw) expect((await search(db, hw, { includeDocuments: true })).some((h) => h.kind === 'device')).toBe(true);
  });
  it('ignores a one-character query', async () => { expect(await search(db, 'a', { includeDocuments: true })).toEqual([]); });
});
