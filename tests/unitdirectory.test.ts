import { describe, it, expect } from 'vitest';
import { world } from './helpers';
import { parseFile } from '../src/parsers';
import { parseUnitDirectory, isUnitDirectory } from '../src/parsers/unitdirectory';
import { importParsed } from '../src/import/commit';

const CSV = `Bldg #,Unit #,Acct #,Name,Address,# Occ,Start Date,End Date,Balance,Alt CustID,Action
0001,000101,1,JANE EXAMPLE,1 A ST APT 101,2,08/11/26,,112.32,x1,Edit
0001,000102,2,VACANT,1 A ST APT 102,null,,,0,x2,Edit
0001,000103,3,PAT EXAMPLE,1 A ST APT 103,1,01/02/25,06/30/26,0,x3,Edit
`;

describe('Unit Directory', () => {
  it('is recognised and reads only building, unit and dates', async () => {
    expect(isUnitDirectory(CSV)).toBe(true);
    const p = parseUnitDirectory(CSV);
    expect(p.rows).toEqual([
      { building: '0001', unit: '000101', moveInOn: '2026-08-11', priorMoveOutOn: null, vacant: false },
      { building: '0001', unit: '000102', moveInOn: null, priorMoveOutOn: null, vacant: true },
      { building: '0001', unit: '000103', moveInOn: null, priorMoveOutOn: '2026-06-30', vacant: true },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/JANE|PAT|112\.32/);
    const viaFile = await parseFile(new TextEncoder().encode(CSV));
    expect(viaFile.kind).toBe('unit_directory');
  });

  it('sets move-in dates on known units, reports unknown ones, and keeps no copy of the file', async () => {
    const { db, pid } = await world();
    await db.query(`INSERT INTO building (property_id,label) VALUES ($1,'1') ON CONFLICT DO NOTHING`, [pid]);
    const u = (await db.query<{ id: string }>(`SELECT unit_id id FROM unit_alias WHERE property_id=$1 LIMIT 1`, [pid])).rows[0];
    const alias = (await db.query<{ b: string; u: string }>(`SELECT building_label b, unit_label u FROM unit_alias WHERE unit_id=$1`, [u.id])).rows[0];
    const csv = `Bldg #,Unit #,Name,Start Date,End Date,# Occ\n${alias.b},${alias.u},SOMEONE,03/04/26,,1\n9,999,NOBODY,03/04/26,,1\n`;
    const bytes = new TextEncoder().encode(csv);
    const r = await importParsed(db, pid, await parseFile(bytes), { fileBytes: bytes, filename: 'ud.csv' });
    expect(r).toMatchObject({ kind: 'unit_directory', occupancyUpdated: 1 });
    expect(r.unmatched).toHaveLength(1);
    expect((await db.query<{ move_in_on: string }>(`SELECT move_in_on::text FROM unit WHERE id=$1`, [u.id])).rows[0].move_in_on).toBe('2026-03-04');
    expect((await db.query<{ raw_file: unknown }>(`SELECT raw_file FROM import_batch WHERE id=$1`, [r.batchId])).rows[0].raw_file).toBeNull();
  });
});
