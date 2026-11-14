// WA Notes: per-property system configuration, technician instructions, equipment to bring and property-specific prices.
import { UserError } from '../errors';
import type { Db, Q } from '../db';

import { loadLists } from '../lists/lists';
// Brands, utilities, milestones and price items are editable lists (Admin > Lists).

export interface SystemNotes {
  utilities: { utility: string; device: string }[];
  systemBrand: string | null; systemId: string | null; collectorLocation: string | null;
  milestoneKind: string | null; milestoneOn: string | null;
  techNote: string | null; transmitterDevice: string | null; meterDevice: string | null;
  equipment: { qty: number; device: string }[];
}
export type PropertyPrices = Record<string, number>;

export const EMPTY_NOTES: SystemNotes = { utilities: [], systemBrand: null, systemId: null, collectorLocation: null, milestoneKind: null, milestoneOn: null, techNote: null, transmitterDevice: null, meterDevice: null, equipment: [] };

export async function getSystemNotes(q: Q, propertyId: string): Promise<SystemNotes> {
  const r = (await q.query<{ utilities: SystemNotes['utilities']; system_brand: string | null; system_id: string | null; collector_location: string | null; milestone_kind: SystemNotes['milestoneKind'];
    milestone_on: string | null; tech_note: string | null; transmitter_device: string | null; meter_device: string | null; equipment: SystemNotes['equipment'] }>(
    `SELECT utilities, system_brand, system_id, collector_location, milestone_kind, milestone_on::text, tech_note, transmitter_device, meter_device, equipment FROM property_system WHERE property_id=$1`, [propertyId])).rows[0];
  if (!r) return { ...EMPTY_NOTES };
  return { utilities: r.utilities ?? [], systemBrand: r.system_brand, systemId: r.system_id, collectorLocation: r.collector_location, milestoneKind: r.milestone_kind, milestoneOn: r.milestone_on,
    techNote: r.tech_note, transmitterDevice: r.transmitter_device, meterDevice: r.meter_device, equipment: r.equipment ?? [] };
}

export async function getPropertyPrices(q: Q, propertyId: string): Promise<PropertyPrices> {
  const r = await q.query<{ item: string; price: string }>(`SELECT item, price::text FROM property_price WHERE property_id=$1`, [propertyId]);
  return Object.fromEntries(r.rows.map((x) => [x.item, Number(x.price)]));
}

/** A property's own prices as they were at the end of a date (from the history). */
export async function propertyPricesOn(q: Q, propertyId: string, date: string): Promise<PropertyPrices> {
  const r = await q.query<{ item: string; price: string | null }>(
    `SELECT DISTINCT ON (item) item, price::text FROM property_price_history
      WHERE property_id=$1 AND changed_at::date <= $2::date ORDER BY item, changed_at DESC, id DESC`, [propertyId, date]);
  return Object.fromEntries(r.rows.filter((x) => x.price !== null).map((x) => [x.item, Number(x.price)]));
}

/** Every change to a property's own prices, newest first. */
export async function propertyPriceHistory(q: Q, propertyId: string) {
  return (await q.query<{ item: string; price: string | null; on: string; by: string | null }>(
    `SELECT h.item, h.price::text, h.changed_at::text "on", u.name by FROM property_price_history h LEFT JOIN app_user u ON u.id=h.changed_by
      WHERE h.property_id=$1 ORDER BY h.changed_at DESC, h.id DESC`, [propertyId])).rows.map((r) => ({ ...r, price: r.price === null ? null : Number(r.price) }));
}

const clean = (s: string | null | undefined) => (s ?? '').trim() || null;

/** Replace the property's notes and prices as one unit. */
export async function saveSystemNotes(db: Db, propertyId: string, n: SystemNotes, prices: PropertyPrices, msa: boolean, userId: string | null): Promise<void> {
  const lists = await loadLists(db);
  const items = lists.items('price_item', { includeRetired: true }).map((i) => i.code);   // a retired item keeps the price it has
  if (n.milestoneKind && !lists.items('milestone', { includeRetired: true }).some((i) => i.code === n.milestoneKind)) throw new UserError(`"${n.milestoneKind}" is not on the milestone list.`);
  for (const [item, p] of Object.entries(prices)) if (!items.includes(item) || !Number.isFinite(p) || p < 0 || Math.round(p * 100) !== p * 100) throw new UserError(`Price for "${item}" must be a dollar amount.`);
  for (const e of n.equipment) if (!Number.isInteger(e.qty) || e.qty < 1) throw new UserError('Equipment quantities must be whole numbers of 1 or more.');
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO property_system (property_id,utilities,system_brand,system_id,collector_location,milestone_kind,milestone_on,tech_note,transmitter_device,meter_device,equipment,updated_by,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       ON CONFLICT (property_id) DO UPDATE SET utilities=$2,system_brand=$3,system_id=$4,collector_location=$5,milestone_kind=$6,milestone_on=$7,tech_note=$8,transmitter_device=$9,meter_device=$10,equipment=$11,updated_by=$12,updated_at=now()`,
      [propertyId, JSON.stringify(n.utilities.filter((u) => u.utility || u.device)), clean(n.systemBrand), clean(n.systemId), clean(n.collectorLocation), n.milestoneKind || null, n.milestoneOn || null,
       clean(n.techNote), clean(n.transmitterDevice), clean(n.meterDevice), JSON.stringify(n.equipment.filter((e) => e.device.trim())), userId]);
    // Keep a dated history of every price that changed, so a past quote or invoice can be explained.
    const before = await getPropertyPrices(tx, propertyId);
    for (const item of new Set([...Object.keys(before), ...Object.keys(prices)]))
      if (before[item] !== prices[item]) await tx.query(`INSERT INTO property_price_history (property_id,item,price,changed_by) VALUES ($1,$2,$3,$4)`, [propertyId, item, prices[item] ?? null, userId]);
    await tx.query(`DELETE FROM property_price WHERE property_id=$1`, [propertyId]);
    for (const [item, price] of Object.entries(prices)) await tx.query(`INSERT INTO property_price (property_id,item,price) VALUES ($1,$2,$3)`, [propertyId, item, price]);
    await tx.query(`UPDATE property SET msa=$2 WHERE id=$1`, [propertyId, msa]);
  });
}

/** "35 | Zenner ETR-U" per line -> equipment rows. A line without a quantity counts as 1. */
export function parseEquipment(text: string): SystemNotes['equipment'] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(\d+)\s*[|x×:,-]?\s+(.+)$/.exec(l) ?? /^(\d+)\s*\|\s*(.+)$/.exec(l);
    return m ? { qty: Number(m[1]), device: m[2].trim() } : { qty: 1, device: l };
  });
}
export const equipmentText = (e: SystemNotes['equipment']) => e.map((x) => `${x.qty} | ${x.device}`).join('\n');

/** What the technician brings: parts counted from the document, named from the notes, then the standing equipment. */
export function bringList(notes: SystemNotes, lines: { component: string | null; quantity: number; include: boolean; partCovered?: boolean }[]): { qty: number; device: string }[] {
  let tx = 0; let mt = 0; let bat = 0;
  for (const l of lines.filter((x) => x.include)) {
    if (l.component === 'battery') bat += l.quantity;
    if (l.component === 'transmitter' || l.component === 'both') tx += l.quantity;
    if (l.component === 'meter' || l.component === 'both') mt += l.quantity;
  }
  const out: { qty: number; device: string }[] = [];
  if (tx) out.push({ qty: tx, device: notes.transmitterDevice ?? 'Transmitter' });
  if (mt) out.push({ qty: mt, device: notes.meterDevice ?? 'Meter' });
  if (bat) out.push({ qty: bat, device: 'Transmitter battery (match the transmitter model)' });
  return [...out, ...notes.equipment];
}
