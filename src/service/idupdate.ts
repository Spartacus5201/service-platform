// The ID update record: what the billing system (UBS) holds for each unit we changed, and what it should hold now.
// Built from a visit's replacements; the coordinator can override Port, Net, System and Meter type before export.
import ExcelJS from 'exceljs';
import type { Db } from '../db';
import { LIVE_EVENT, ServiceError } from './record';

type Q = Pick<Db, 'query'>;

export interface IdUpdateRow {
  id: string; endpointId: string; building: string; unit: string; address: string | null; service: string;
  oldMdid: string | null; oldMiuid: string | null; oldPort: string; oldNet: string;
  newMdid: string | null; newMiuid: string | null; newPort: string; newNet: string;
  systemType: string | null; meterType: string | null; recoup: boolean;
  status: 'pending' | 'exported' | 'confirmed'; exportedAt: string | null; confirmedAt: string | null;
}

/** Create or refresh the rows for a visit. Derived fields follow the visit; overrides (port, net, system, meter type) are kept. Exported rows are left alone. */
export async function buildIdUpdate(db: Db, visitId: string): Promise<IdUpdateRow[]> {
  const v = (await db.query<{ property_id: string; outcome: string }>(`SELECT property_id, outcome FROM visit WHERE id=$1`, [visitId])).rows[0];
  if (!v) throw new ServiceError('Unknown visit.');
  const parts = await db.query<{ endpoint_id: string; kind: string; old_hw: string | null; new_hw: string | null; new_model: string | null; old_model: string | null }>(
    `SELECT se.endpoint_id, nd.kind, od.hardware_id old_hw, nd.hardware_id new_hw, nd.model new_model, od.model old_model
       FROM service_event se JOIN event_part ep ON ep.service_event_id=se.id JOIN device nd ON nd.id=ep.new_device_id LEFT JOIN device od ON od.id=ep.old_device_id
      WHERE se.visit_id=$1 AND ${LIVE_EVENT}`, [visitId]);
  const brand = (await db.query<{ system_brand: string | null }>(`SELECT system_brand FROM property_system WHERE property_id=$1`, [v.property_id])).rows[0]?.system_brand ?? null;

  const byEp = new Map<string, typeof parts.rows>();
  parts.rows.forEach((p) => byEp.set(p.endpoint_id, [...(byEp.get(p.endpoint_id) ?? []), p]));
  await db.transaction(async (tx) => {
    for (const [eid, ps] of byEp) {
      const ep = (await tx.query<{ vendor_label: string | null; port: string; net: string }>(`SELECT vendor_label, port, net FROM endpoint WHERE id=$1`, [eid])).rows[0];
      const tx1 = ps.find((p) => p.kind !== 'meter');
      const mtr = ps.find((p) => p.kind === 'meter');
      const sys = (await tx.query<{ meter_type_id: string | null }>(`SELECT r.meter_type_id FROM audit_reading r WHERE r.endpoint_id=$1 AND r.meter_type_id IS NOT NULL ORDER BY r.read_date_1 DESC NULLS LAST LIMIT 1`, [eid])).rows[0]?.meter_type_id ?? brand;
      const curMeter = (await tx.query<{ model: string | null }>(`SELECT d.model FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=$1 AND d.kind='meter' AND i.removed_on IS NULL AND d.status='active' LIMIT 1`, [eid])).rows[0]?.model ?? null;
      const oldMdid = tx1 ? tx1.old_hw : null; const newMdid = tx1 ? tx1.new_hw : null;
      await tx.query(
        `INSERT INTO id_update (visit_id,endpoint_id,old_mdid,old_miuid,old_port,old_net,new_mdid,new_miuid,new_port,new_net,system_type,meter_type,recoup)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$4,$5,$6,$8,$9,$10)
         ON CONFLICT (visit_id, endpoint_id) DO UPDATE SET old_mdid=$3, new_mdid=$7, recoup=$10, old_miuid=$4, new_miuid=COALESCE(id_update.new_miuid,$4)
         WHERE id_update.status='pending'`,
        [visitId, eid, oldMdid ?? (tx1 ? null : (await currentMdid(tx, eid))), ep.vendor_label, ep.port, ep.net, newMdid ?? (tx1 ? null : (await currentMdid(tx, eid))), sys, mtr?.new_model ?? curMeter, !!tx1 && !!oldMdid]);
    }
    // Rows whose replacement was voided disappear while still pending.
    await tx.query(`DELETE FROM id_update WHERE visit_id=$1 AND status='pending' AND NOT (endpoint_id = ANY($2::uuid[]))`, [visitId, [...byEp.keys()]]);
  });
  return idUpdateRows(db, visitId);
}

const currentMdid = async (q: Q, endpointId: string) => (await q.query<{ hardware_id: string | null }>(
  `SELECT d.hardware_id FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=$1 AND d.kind='transmitter' AND i.removed_on IS NULL AND d.status='active' LIMIT 1`, [endpointId])).rows[0]?.hardware_id ?? null;

export async function idUpdateRows(db: Q, visitId: string): Promise<IdUpdateRow[]> {
  const r = await db.query<{ id: string; endpoint_id: string; building: string; unit: string; address: string | null; service_code: string; old_mdid: string | null; old_miuid: string | null; old_port: string; old_net: string;
    new_mdid: string | null; new_miuid: string | null; new_port: string; new_net: string; system_type: string | null; meter_type: string | null; recoup: boolean;
    status: IdUpdateRow['status']; exported_at: string | null; confirmed_at: string | null }>(
    `SELECT i.id, i.endpoint_id, b.label building, u.current_label unit, u.service_address address, e.service_code, i.old_mdid, i.old_miuid, i.old_port, i.old_net, i.new_mdid, i.new_miuid, i.new_port, i.new_net,
            i.system_type, i.meter_type, i.recoup, i.status, i.exported_at::text, i.confirmed_at::text
       FROM id_update i JOIN endpoint e ON e.id=i.endpoint_id JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id
      WHERE i.visit_id=$1 ORDER BY b.label, u.current_label, e.service_code`, [visitId]);
  return r.rows.map((x) => ({ id: x.id, endpointId: x.endpoint_id, building: x.building, unit: x.unit, address: x.address, service: x.service_code,
    oldMdid: x.old_mdid, oldMiuid: x.old_miuid, oldPort: x.old_port, oldNet: x.old_net, newMdid: x.new_mdid, newMiuid: x.new_miuid, newPort: x.new_port, newNet: x.new_net,
    systemType: x.system_type, meterType: x.meter_type, recoup: x.recoup, status: x.status, exportedAt: x.exported_at, confirmedAt: x.confirmed_at }));
}

export interface IdOverride { id: string; newMiuid: string | null; newPort: string | null; newNet: string | null; systemType: string | null; meterType: string | null }

/** Port and Net are almost always 0; when they differ the coordinator types the value from the billing system. */
export async function saveIdOverrides(db: Db, visitId: string, edits: IdOverride[]): Promise<void> {
  for (const e of edits) {
    for (const [k, v] of [['Port', e.newPort], ['Net', e.newNet]] as const) if (v !== null && !/^\d{1,4}$/.test(v)) throw new ServiceError(`${k} must be a whole number (usually 0).`);
    const res = await db.query(
      `UPDATE id_update SET new_miuid=$3, new_port=COALESCE($4,'0'), new_net=COALESCE($5,'0'), system_type=$6, meter_type=$7 WHERE id=$1 AND visit_id=$2 AND status='pending'`,
      [e.id, visitId, e.newMiuid, e.newPort, e.newNet, e.systemType, e.meterType]);
    if (!res.affectedRows) throw new ServiceError('A row is unknown or was already exported.');
  }
}

const mdid = (v: string | null) => v ?? '';
/** The key the billing system uses: MIUID, MDID, Port and Net joined. */
export const meterKey = (miuid: string | null, md: string | null, port: string, net: string) => `${mdid(miuid)}${mdid(md)}${port}${net}`;

/** The workbook the admin works from. Same column positions as the existing ID Update template. */
export async function idUpdateXlsx(db: Db, visitId: string, meta: { property: string; classId: string; visitedOn: string; technician: string | null }): Promise<Uint8Array> {
  const rows = await idUpdateRows(db, visitId);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Changes');
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const bold = { bold: true };
  ws.mergeCells('A1:H1'); ws.mergeCells('K1:S1'); ws.mergeCells('U1:AI1');
  ws.getCell('A1').value = 'FROM UBS'; ws.getCell('K1').value = 'NEW/CHANGED INFO'; ws.getCell('U1').value = 'QUALITY CHECK (re-pull from UBS and paste here after the update)';
  ws.getCell('A1').fill = fill('FFD9D9D9'); ws.getCell('K1').fill = fill('FFFFE699'); ws.getCell('U1').fill = fill('FFC6E0B4');
  const head: Record<string, string> = { A: 'Serv. Address', B: 'Bldg', C: 'Unit', D: 'MDID', E: 'MIUID', F: 'Port', G: 'Net', H: 'Old Meter ID', I: 'MDID same?', J: 'MIUID same?',
    K: 'MDID', L: 'MIUID', M: 'Port', N: 'Net', P: 'New Meter ID', R: 'System Type', S: 'Meter Type',
    U: 'Bldg', V: 'Unit', W: 'MDID', X: 'MIUID', Y: 'Port', Z: 'Net', AB: 'MDID Match', AC: 'MIUID Match', AD: 'Port Match', AE: 'Net Match', AF: 'Sys Match', AG: 'Mtr Match', AH: 'System', AI: 'Meter' };
  for (const [col, text] of Object.entries(head)) { const c = ws.getCell(`${col}2`); c.value = text; c.font = bold; }
  ws.getRow(1).font = bold;
  rows.forEach((r, i) => {
    const n = i + 3;
    const set = (col: string, v: unknown) => { ws.getCell(`${col}${n}`).value = v as never; };
    set('A', r.address ?? ''); set('B', r.building); set('C', r.unit); set('D', r.oldMdid ?? ''); set('E', r.oldMiuid ?? ''); set('F', Number(r.oldPort)); set('G', Number(r.oldNet));
    set('H', { formula: `E${n}&D${n}&F${n}&G${n}` }); set('I', { formula: `IF(D${n}=K${n},TRUE,FALSE)` }); set('J', { formula: `IF(E${n}=L${n},TRUE,FALSE)` });
    set('K', r.newMdid ?? ''); set('L', r.newMiuid ?? ''); set('M', Number(r.newPort)); set('N', Number(r.newNet)); set('P', { formula: `L${n}&K${n}&M${n}&N${n}` });
    set('R', r.systemType ?? ''); set('S', r.meterType ?? '');
    set('AB', { formula: `W${n}=K${n}` }); set('AC', { formula: `X${n}=L${n}` }); set('AD', { formula: `Y${n}=M${n}` }); set('AE', { formula: `Z${n}=N${n}` });
    set('AF', { formula: `R${n}=AH${n}` }); set('AG', { formula: `S${n}=AI${n}` });
  });
  const widths: Record<string, number> = { A: 31, B: 7, C: 8, D: 14, E: 10, F: 6, G: 6, H: 24, I: 11, J: 12, K: 14, L: 10, M: 6, N: 6, O: 1.5, P: 24, Q: 1.5, R: 12, S: 14, T: 1.5, U: 7, V: 8, W: 14, X: 10, Y: 6, Z: 6, AA: 1.5, AB: 11, AC: 12, AD: 11, AE: 10, AF: 10, AG: 10, AH: 12, AI: 14 };
  for (const [c, w] of Object.entries(widths)) ws.getColumn(c).width = w;
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  const rc = wb.addWorksheet('AMR recoup');
  ['Bldg', 'Unit', 'Old Meter ID', 'New Meter ID', 'True/False', '', 'Recoup Date'].forEach((t, i) => { const c = rc.getCell(1, i + 1); c.value = t; c.font = bold; });
  rows.filter((r) => r.recoup).forEach((r, i) => {
    const n = i + 2;
    rc.getCell(`A${n}`).value = r.building; rc.getCell(`B${n}`).value = r.unit;
    rc.getCell(`C${n}`).value = meterKey(r.oldMiuid, r.oldMdid, r.oldPort, r.oldNet); rc.getCell(`D${n}`).value = meterKey(r.newMiuid, r.newMdid, r.newPort, r.newNet);
    rc.getCell(`E${n}`).value = { formula: `C${n}=D${n}` }; rc.getCell(`G${n}`).value = meta.visitedOn;
  });
  [9, 9, 24, 24, 11, 3, 13].forEach((w, i) => { rc.getColumn(i + 1).width = w; });

  const info = wb.addWorksheet('Read me');
  [['ID update record'], ['Property', `${meta.property} (${meta.classId})`], ['Service date', meta.visitedOn], ['Technician', meta.technician ?? ''], ['Units changed', rows.length], [],
    ['FROM UBS is what the billing system should hold now (our record of the equipment before the visit).'],
    ['NEW/CHANGED INFO is what it should hold after the update. Port and Net are almost always 0; check any that differ.'],
    ['After updating UBS, re-pull the units and paste them into QUALITY CHECK; every match column should read TRUE.'],
    ['AMR recoup lists transmitters that came out and should be recovered.']]
    .forEach((r) => info.addRow(r));
  info.getCell('A1').font = { bold: true, size: 13 }; info.getColumn(1).width = 18; info.getColumn(2).width = 60;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function markExported(db: Db, visitId: string): Promise<number> {
  const r = await db.query(`UPDATE id_update SET status='exported', exported_at=now() WHERE visit_id=$1 AND status='pending'`, [visitId]);
  return r.affectedRows ?? 0;
}
