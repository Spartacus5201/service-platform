// Low battery -> preventative maintenance (PM).
// A transmitter whose latest check-in reports low battery is flagged PM even if it still reads. Today only the
// Inovonics CIM carries the flag; the Next Century CIM is read when its export has a battery column.
// Settings (all optional): pm_code (label used on audits and documents, default "PM"),
//   pm_warranty ("part" = covered like any part under warranty [default], "never" = always billable).
import type { Db } from '../db';

type Q = Pick<Db, 'query'>;
export const PM_DESCRIPTION = 'Preventative Maintenance - Low Battery Transmitter';

export interface LowBattery {
  deviceId: string; hardwareId: string | null; endpointId: string | null; propertyId: string;
  building: string | null; unit: string | null; service: string | null;
  firstLowOn: string; lastCheckIn: string; partInstalledOn: string | null;
}

export async function pmSettings(q: Q): Promise<{ code: string; warranty: 'part' | 'never' }> {
  const rows = (await q.query<{ key: string; value: unknown }>(`SELECT key, value FROM setting WHERE key IN ('pm_code','pm_warranty')`)).rows;
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const code = typeof get('pm_code') === 'string' && (get('pm_code') as string).trim() ? (get('pm_code') as string).trim() : 'PM';
  return { code, warranty: get('pm_warranty') === 'never' ? 'never' : 'part' };
}

/**
 * Active transmitters whose most recent check-in reports low battery. firstLowOn is the start of the current
 * low-battery run (the first low check-in after the last good one).
 */
export async function lowBatteryDevices(q: Q, where: { propertyId?: string; endpointIds?: string[] }): Promise<LowBattery[]> {
  const args: unknown[] = []; const cond: string[] = [];
  if (where.propertyId) { args.push(where.propertyId); cond.push(`d.property_id = $${args.length}`); }
  if (where.endpointIds) { args.push(where.endpointIds); cond.push(`i.endpoint_id = ANY($${args.length})`); }
  return (await q.query<{ device_id: string; hardware_id: string | null; endpoint_id: string | null; property_id: string; building: string | null; unit: string | null; service: string | null; first_low: string; last_in: string; installed_on: string | null }>(
    `WITH latest AS (
       SELECT DISTINCT ON (c.device_id) c.device_id, c.checked_in_at, c.low_battery FROM device_checkin c
        WHERE c.checked_in_at IS NOT NULL ORDER BY c.device_id, c.checked_in_at DESC)
     SELECT d.id device_id, d.hardware_id, i.endpoint_id, d.property_id, b.label building, u.current_label unit, e.service_code service,
            (SELECT min(c2.checked_in_at)::date::text FROM device_checkin c2 WHERE c2.device_id=d.id AND c2.low_battery
               AND c2.checked_in_at > COALESCE((SELECT max(c3.checked_in_at) FROM device_checkin c3 WHERE c3.device_id=d.id AND c3.low_battery = false), '-infinity')) first_low,
            l.checked_in_at::date::text last_in, i.installed_on::text installed_on
       FROM latest l JOIN device d ON d.id=l.device_id
       LEFT JOIN installation i ON i.device_id=d.id AND i.removed_on IS NULL
       LEFT JOIN endpoint e ON e.id=i.endpoint_id LEFT JOIN unit u ON u.id=e.unit_id LEFT JOIN building b ON b.id=u.building_id
      WHERE l.low_battery AND d.status='active' AND d.kind IN ('transmitter','combo') ${cond.length ? `AND ${cond.join(' AND ')}` : ''}
      ORDER BY b.label, u.current_label`, args)).rows.map((r) => ({
    deviceId: r.device_id, hardwareId: r.hardware_id, endpointId: r.endpoint_id, propertyId: r.property_id, building: r.building, unit: r.unit, service: r.service,
    firstLowOn: r.first_low, lastCheckIn: r.last_in, partInstalledOn: r.installed_on,
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
  const { warranty } = await pmSettings(db);
  return devs.map((d) => {
    const l = d.endpointId ? byEp.get(d.endpointId) : undefined;
    const covered = warranty === 'never' ? false : !!l?.coverage.partCovered;
    return { ...d, auditCode: l?.code ?? null, failing: !!l && l.recommendation.action !== 'No action', partCovered: covered, partWarranty: l?.coverage.part.status ?? 'unknown' };
  });
}

export async function lowBatteryXlsx(rows: Awaited<ReturnType<typeof lowBatteryReport>>, property: { name: string; classId: string }, asOf: string): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Low battery');
  ws.addRow([`Low battery report: ${property.name} (${property.classId}) as of ${asOf}`]).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(['Bldg', 'Unit', 'Service', 'Transmitter ID', 'Low since', 'Last check-in', 'Latest audit', 'Also failing', 'Part warranty']);
  head.font = { bold: true };
  for (const r of rows) ws.addRow([r.building, r.unit, r.service, r.hardwareId, r.firstLowOn, r.lastCheckIn, r.auditCode ?? '', r.failing ? 'Yes' : 'No', r.partCovered ? 'Covered' : r.partWarranty]);
  ws.columns.forEach((c, i) => { c.width = [8, 10, 9, 18, 12, 14, 12, 12, 14][i]; });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
