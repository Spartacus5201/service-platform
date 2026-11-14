// Low battery -> preventative maintenance (PM).
// A transmitter whose latest check-in reports low battery is flagged PM even if it still reads. Today only the
// Inovonics CIM carries the flag; the Next Century CIM is read when its export has a battery column.
// Settings (all optional): pm_code (label used on audits and documents, default "PM"),
//   pm_warranty ("part" = parts and labor covered like any warranty work [default], "never" = always billable),
//   pm_battery_threshold (percent at or below which a battery is flagged low on audits and reports, default 25),
//   pm_wa_threshold (percent at or below which a low battery goes on the WA for service, default 1),
//   pm_battery_price (battery price when the catalog has no battery for the transmitter model, default 9.10).
import type { Db } from '../db';

type Q = Pick<Db, 'query'>;
export const PM_DESCRIPTION = 'Preventative Maintenance - Transmitter Battery Replacement';

export interface LowBattery {
  deviceId: string; hardwareId: string | null; endpointId: string | null; propertyId: string;
  building: string | null; unit: string | null; service: string | null;
  firstLowOn: string; lastCheckIn: string; partInstalledOn: string | null;
  batteryLevel: number | null; model: string | null;
}

export interface PmSettings { code: string; warranty: 'part' | 'never'; threshold: number; waThreshold: number; batteryPrice: number }
export async function pmSettings(q: Q): Promise<PmSettings> {
  const rows = (await q.query<{ key: string; value: unknown }>(`SELECT key, value FROM setting WHERE key IN ('pm_code','pm_warranty','pm_battery_threshold','pm_wa_threshold','pm_battery_price')`)).rows;
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const n = (k: string, d: number) => { const x = Number(get(k)); return get(k) !== undefined && Number.isFinite(x) ? x : d; };
  const code = typeof get('pm_code') === 'string' && (get('pm_code') as string).trim() ? (get('pm_code') as string).trim() : 'PM';
  return { code, warranty: get('pm_warranty') === 'never' ? 'never' : 'part', threshold: n('pm_battery_threshold', 25), waThreshold: n('pm_wa_threshold', 1), batteryPrice: n('pm_battery_price', 9.1) };
}

/**
 * Battery for a transmitter model: the battery set on the model in the equipment registry; else a catalog battery
 * whose name mentions the model; else the default battery price.
 */
export async function batteryFor(q: Q, model: string | null, asOf: string, pm?: PmSettings) {
  const s = pm ?? await pmSettings(q);
  const { batteryForModel } = await import('../equipment/registry');
  const reg = await batteryForModel(q, model, asOf);
  if (reg && reg.price !== null) return { itemId: reg.id, price: reg.price, name: reg.name };
  const item = model ? (await q.query<{ id: string; name: string; price: string | null }>(
    `SELECT id, name, price::text FROM catalog_item WHERE kind='part' AND component='battery' AND active AND effective_from <= $2
        AND position(lower($1) in lower(name || ' ' || COALESCE(part_number,''))) > 0 ORDER BY effective_from DESC LIMIT 1`, [model, asOf])).rows[0] : undefined;
  return { itemId: item?.id ?? null, price: item?.price !== undefined && item?.price !== null ? Number(item.price) : s.batteryPrice, name: item?.name ?? 'Transmitter battery' };
}

/**
 * Active transmitters whose most recent check-in reports low battery. firstLowOn is the start of the current
 * low-battery run (the first low check-in after the last good one).
 */
export async function lowBatteryDevices(q: Q, where: { propertyId?: string; endpointIds?: string[] }): Promise<LowBattery[]> {
  const { threshold } = await pmSettings(q);
  const args: unknown[] = [threshold]; const cond: string[] = [];
  const LOW = (a: string) => `(${a}.low_battery OR ${a}.battery_level <= $1)`;
  const OK = (a: string) => `(${a}.low_battery = false OR ${a}.battery_level > $1)`;
  if (where.propertyId) { args.push(where.propertyId); cond.push(`d.property_id = $${args.length}`); }
  if (where.endpointIds) { args.push(where.endpointIds); cond.push(`i.endpoint_id = ANY($${args.length})`); }
  return (await q.query<{ device_id: string; hardware_id: string | null; endpoint_id: string | null; property_id: string; building: string | null; unit: string | null; service: string | null; first_low: string; last_in: string; installed_on: string | null; battery_level: string | null; model: string | null }>(
    `WITH latest AS (
       SELECT DISTINCT ON (c.device_id) c.device_id, c.checked_in_at, c.low_battery, c.battery_level FROM device_checkin c
        WHERE c.checked_in_at IS NOT NULL ORDER BY c.device_id, c.checked_in_at DESC)
     SELECT d.id device_id, d.hardware_id, l.battery_level::text, d.model, i.endpoint_id, d.property_id, b.label building, u.current_label unit, e.service_code service,
            (SELECT min(c2.checked_in_at)::date::text FROM device_checkin c2 WHERE c2.device_id=d.id AND ${LOW('c2')}
               AND c2.checked_in_at > COALESCE((SELECT max(c3.checked_in_at) FROM device_checkin c3 WHERE c3.device_id=d.id AND ${OK('c3')}), '-infinity')) first_low,
            l.checked_in_at::date::text last_in, i.installed_on::text installed_on
       FROM latest l JOIN device d ON d.id=l.device_id
       LEFT JOIN installation i ON i.device_id=d.id AND i.removed_on IS NULL
       LEFT JOIN endpoint e ON e.id=i.endpoint_id LEFT JOIN unit u ON u.id=e.unit_id LEFT JOIN building b ON b.id=u.building_id
      WHERE ${LOW('l')} AND d.status='active' AND d.kind IN ('transmitter','combo') ${cond.length ? `AND ${cond.join(' AND ')}` : ''}
      ORDER BY b.label, u.current_label`, args)).rows.map((r) => ({
    deviceId: r.device_id, hardwareId: r.hardware_id, endpointId: r.endpoint_id, propertyId: r.property_id, building: r.building, unit: r.unit, service: r.service,
    firstLowOn: r.first_low, lastCheckIn: r.last_in, partInstalledOn: r.installed_on,
    batteryLevel: r.battery_level === null ? null : Number(r.battery_level), model: r.model,
  }));
}

/** Low battery report rows for one property, with whether a replacement would fall under warranty. */
export async function lowBatteryReport(db: Db, propertyId: string, asOf: string) {
  const { auditLines } = await import('../queries/audit');
  const { latestAuditBatch } = await import('./unitstatus');
  const devs = await lowBatteryDevices(db, { propertyId });
  const b = await latestAuditBatch(db, propertyId);
  const lines = b ? await auditLines(db, b.id, asOf) : [];
  const byEp = new Map(lines.map((l) => [l.endpointId, l]));
  const pm = await pmSettings(db);
  // A transmitter that has not checked in for 7 days before the newest check-in at the property has most likely stopped.
  const newest = (await db.query<{ on: string | null }>(`SELECT max(c.checked_in_at)::date::text "on" FROM device_checkin c JOIN device d ON d.id=c.device_id WHERE d.property_id=$1`, [propertyId])).rows[0]?.on ?? asOf;
  const out = [];
  for (const d of devs) {
    const l = d.endpointId ? byEp.get(d.endpointId) : undefined;
    const covered = pm.warranty === 'never' ? false : !!l?.coverage.partCovered;
    const bat = await batteryFor(db, d.model, asOf, pm);
    const stopped = Date.parse(newest) - Date.parse(d.lastCheckIn) > 7 * 86400000;
    out.push({ ...d, auditCode: l?.code ?? null, failing: !!l && l.recommendation.action !== 'No action', stopped, partCovered: covered, partWarranty: l?.coverage.part.status ?? 'unknown', batteryPrice: bat.price });
  }
  return out;
}

export async function lowBatteryXlsx(rows: Awaited<ReturnType<typeof lowBatteryReport>>, property: { name: string; classId: string }, asOf: string): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Low battery');
  ws.addRow([`Low battery report: ${property.name} (${property.classId}) as of ${asOf}`]).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(['Bldg', 'Unit', 'Service', 'Transmitter ID', 'Model', 'Battery %', 'Low since', 'Last check-in', 'Stopped checking in', 'Latest audit', 'Also failing', 'Battery price', 'Warranty']);
  head.font = { bold: true };
  for (const r of rows) ws.addRow([r.building, r.unit, r.service, r.hardwareId, r.model ?? '', r.batteryLevel ?? '', r.firstLowOn, r.lastCheckIn, r.stopped ? 'Yes' : 'No', r.auditCode ?? '', r.failing ? 'Yes' : 'No', r.batteryPrice, r.partCovered ? 'Covered' : r.partWarranty]);
  ws.columns.forEach((c, i) => { c.width = [8, 10, 9, 16, 10, 10, 12, 14, 12, 12, 12, 12, 12][i]; });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Does this low battery go on the WA? A yes/no flag (no percent) counts; a percent must be at or below the WA level. */
export const forWa = (b: { level: number | null } | null, pm: PmSettings) => !!b && (b.level === null || b.level <= pm.waThreshold);
