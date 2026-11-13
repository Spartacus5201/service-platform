import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { world } from './helpers';
import { importInventory, componentFor } from '../src/catalog/import';

const HEAD = ['Part Type', 'Description', 'Vendor', 'Part#', 'Notes', 'Cost Verified', 'Initial cost', 'Tarriff', 'Minol Cost', 'Markup', 'Sell Price'];
async function book(rows: (string | number | null)[][], sheet = 'Inventory'): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(sheet);
  ws.addRow(HEAD); rows.forEach((r) => ws.addRow(r));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const row = (type: string, name: string, part: string | null, price: number | null, verified: string | null = null) =>
  [type, name, 'Zenner', part, null, verified, 0, null, 0, 0, price];

describe('price list import', () => {
  it('maps part types to components', () => {
    expect(componentFor('Transmitter ')).toBe('transmitter');
    expect(componentFor('Water Meter')).toBe('meter');
    expect(componentFor('Gas Couplings')).toBeNull();
    expect(componentFor('Electric Enclosure')).toBeNull();
  });

  it('previews without writing, then applies; unchanged re-import writes nothing', async () => {
    const { db } = await world();
    const file = await book([row('Transmitter', 'TX 100', 'A1', 85), row('Water Meter', 'WM 3/4', 'B2', 140), row('Transmitter', 'No price', null, 0)]);
    const before = Number((await db.query<{ n: string }>(`SELECT count(*) n FROM catalog_item`)).rows[0].n);
    const dry = await importInventory(db, file, '2026-11-12', false);
    expect(dry).toMatchObject({ applied: false, added: 2, skippedNoPrice: 1 });
    expect(Number((await db.query<{ n: string }>(`SELECT count(*) n FROM catalog_item`)).rows[0].n)).toBe(before);
    await importInventory(db, file, '2026-11-12', true);
    const again = await importInventory(db, file, '2026-11-13', true);
    expect(again).toMatchObject({ added: 0, changed: 0, unchanged: 2 });
  });

  it('keeps price history: a new Sell Price adds a later row', async () => {
    const { db } = await world();
    await importInventory(db, await book([row('Transmitter', 'TX 100', 'A1', 85)]), '2026-01-01', true);
    const r = await importInventory(db, await book([row('Transmitter', 'TX 100', 'A1', 90.5)]), '2026-06-01', true);
    expect(r.changes).toEqual([{ name: 'TX 100', partType: 'Transmitter', from: 85, to: 90.5 }]);
    const rows = (await db.query<{ price: string; effective_from: string }>(`SELECT price::text, effective_from::text FROM catalog_item WHERE name='TX 100' ORDER BY effective_from`)).rows;
    expect(rows.map((x) => [x.price, x.effective_from])).toEqual([['85.00', '2026-01-01'], ['90.50', '2026-06-01']]);
  });

  it('marks obsolete items inactive and rejects a wrong file', async () => {
    const { db } = await world();
    await importInventory(db, await book([row('Accessories', 'Old tool', 'Obsolete', 450)]), '2026-11-12', true);
    expect((await db.query<{ active: boolean }>(`SELECT active FROM catalog_item WHERE name='Old tool'`)).rows[0].active).toBe(false);
    await expect(importInventory(db, await book([row('A', 'B', null, 1)], 'Other'), '2026-11-12', false)).rejects.toThrow(/Inventory/);
    await expect(importInventory(db, new Uint8Array([1, 2, 3]), '2026-11-12', false)).rejects.toThrow(/xlsx/);
  });
});
