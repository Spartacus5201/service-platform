import type { Db } from '../db';
import { readWorkbook, headerMap, str, num, ParseError, type Cell } from '../parsers/common';

export interface PriceChange { name: string; partType: string | null; from: number | null; to: number }
export interface CatalogImportResult {
  applied: boolean; sheet: string; rows: number;
  added: number; changed: number; unchanged: number; skippedNoPrice: number; obsolete: number;
  changes: PriceChange[]; addedNames: string[];
}

const COMPONENT: [RegExp, string][] = [
  [/transmitter/i, 'transmitter'], [/collector/i, 'collector'], [/repeater/i, 'repeater'],
  [/meter/i, 'meter'],
];
export function componentFor(partType: string | null): string | null {
  if (!partType || /coupling|enclosure|parts/i.test(partType)) return null;
  return COMPONENT.find(([re]) => re.test(partType))?.[1] ?? null;
}

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Read the "Inventory" sheet of the master price list (.xlsx) and update catalog_item.
 * Sell Price is the price; rows with no price are skipped. An item is matched by part type + description + part number.
 * A different Sell Price adds a new row effective on `asOf`; the old row stays as history. With apply=false nothing is written.
 */
export async function importInventory(db: Db, bytes: Uint8Array, asOf: string, apply: boolean): Promise<CatalogImportResult> {
  let sheets;
  try { sheets = await readWorkbook(bytes); } catch { throw new ParseError('That file could not be read. Save the price list as .xlsx (File > Save As in Excel) and try again.'); }
  const sheet = sheets.find((s) => s.name.trim().toLowerCase() === 'inventory');
  if (!sheet) throw new ParseError('No sheet named "Inventory" in this file.');
  const hi = sheet.rows.findIndex((r) => { const h = headerMap(r); return h.has('description') && h.has('sell price'); });
  if (hi < 0) throw new ParseError('The Inventory sheet needs "Description" and "Sell Price" column headings.');
  const h = headerMap(sheet.rows[hi]);
  const col = (r: Cell[], k: string) => (h.has(k) ? r[h.get(k)!] : null);

  const res: CatalogImportResult = { applied: apply, sheet: sheet.name, rows: 0, added: 0, changed: 0, unchanged: 0, skippedNoPrice: 0, obsolete: 0, changes: [], addedNames: [] };
  const seen = new Set<string>();
  const run = async (q: Db) => {
    for (const r of sheet.rows.slice(hi + 1)) {
      const name = str(col(r, 'description')); if (!name) continue;
      res.rows++;
      const partType = str(col(r, 'part type')); const partNo = str(col(r, 'part#'));
      const price = num(col(r, 'sell price'));
      const obsolete = /obsolete/i.test(`${partNo ?? ''} ${str(col(r, 'cost verified')) ?? ''}`);
      if (obsolete) res.obsolete++;
      if (price === null || price <= 0) { res.skippedNoPrice++; continue; }
      const key = [partType, name, partNo].map((x) => (x ?? '').toLowerCase()).join('|');
      if (seen.has(key)) continue; seen.add(key);   // a repeated row in the sheet: first one wins
      const p = money(price);
      const cur = (await q.query<{ id: string; price: string | null; effective_from: string }>(
        `SELECT id, price::text, effective_from::text FROM catalog_item
          WHERE source='inventory' AND lower(coalesce(part_type,''))=lower($1) AND lower(name)=lower($2) AND lower(coalesce(part_number,''))=lower($3)
          ORDER BY effective_from DESC, id LIMIT 1`, [partType ?? '', name, partNo ?? ''])).rows[0];
      const vendor = str(col(r, 'vendor')); const notes = str(col(r, 'notes'));
      if (!cur) {
        res.added++; res.addedNames.push(name);
        if (apply) await q.query(
          `INSERT INTO catalog_item (name,kind,component,price,effective_from,part_type,vendor,part_number,notes,source,active) VALUES ($1,'part',$2,$3,$4,$5,$6,$7,$8,'inventory',$9)`,
          [name, componentFor(partType), p, asOf, partType, vendor, partNo, notes, !obsolete]);
      } else if (cur.price === null || money(Number(cur.price)) !== p) {
        res.changed++; res.changes.push({ name, partType, from: cur.price === null ? null : Number(cur.price), to: p });
        if (apply) {
          if (cur.effective_from === asOf) await q.query(`UPDATE catalog_item SET price=$2, vendor=$3, notes=$4, active=$5 WHERE id=$1`, [cur.id, p, vendor, notes, !obsolete]);
          else await q.query(
            `INSERT INTO catalog_item (name,kind,component,price,effective_from,part_type,vendor,part_number,notes,source,active,suggest_default)
             SELECT name,kind,component,$2,$3,part_type,$4,part_number,$5,source,$6,suggest_default FROM catalog_item WHERE id=$1`, [cur.id, p, asOf, vendor, notes, !obsolete]);
        }
      } else {
        res.unchanged++;
        if (apply) await q.query(`UPDATE catalog_item SET vendor=$2, notes=$3, active=$4 WHERE id=$1`, [cur.id, vendor, notes, !obsolete]);
      }
    }
  };
  if (apply) await db.transaction(async (tx) => run(tx as unknown as Db)); else await run(db);
  if (!res.rows) throw new ParseError('The Inventory sheet has no items.');
  return res;
}
