import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit, parseManualAudit } from '../src/parsers/audit';
import { recordVisit } from '../src/service/record';
import { voidEvent } from '../src/service/correct';
import { buildIdUpdate, idUpdateRows, idUpdateXlsx, markExported, saveIdOverrides, meterKey } from '../src/service/idupdate';
import { autoAuditGrid, manualAuditGrid, CLASS_ID } from './fixtures';

async function setup() {
  const db = await openDb();
  const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'Test Property') RETURNING id`, [CLASS_ID])).rows[0].id;
  await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
  const eps = (await db.query<{ id: string; unit: string }>(`SELECT e.id, u.current_label unit FROM endpoint e JOIN unit u ON u.id=e.unit_id`)).rows;
  const ep = (u: string) => eps.find((e) => e.unit.trim() === u)!.id;
  return { db, pid, ep };
}

describe('Port and Net', () => {
  it('default to 0 and are read from the Manual Audit when present', async () => {
    const db = await openDb();
    const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'T') RETURNING id`, [CLASS_ID])).rows[0].id;
    const g = manualAuditGrid(); g[2][12] = 3; g[2][13] = 7;           // unit 101: Mport 3, MNetAddr 7
    await importParsed(db, pid, parseManualAudit(g), { createMissing: true });
    const r = await db.query<{ unit: string; port: string; net: string }>(`SELECT u.current_label unit, e.port, e.net FROM endpoint e JOIN unit u ON u.id=e.unit_id ORDER BY 1`);
    expect(r.rows.find((x) => x.unit.trim() === '101')).toMatchObject({ port: '3', net: '7' });
    expect(r.rows.find((x) => x.unit.trim() === '102')).toMatchObject({ port: '0', net: '0' });
  });
});

describe('ID update record', () => {
  it('lists old and new transmitter IDs for replaced units only', async () => {
    const { db, pid, ep } = await setup();
    const old = (await db.query<{ h: string }>(`SELECT d.hardware_id h FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=$1 AND d.kind='transmitter'`, [ep('102')])).rows[0].h;
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-10', technician: 'T', outcome: 'completed', events: [
      { endpointId: ep('102'), action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX1' }] },
      { endpointId: ep('104'), action: 'inspect_test', issueCode: 'HIGH' }] });
    const rows = await buildIdUpdate(db, r.visitId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ oldMdid: old, newMdid: 'NEWTX1', oldMiuid: '102-W', newMiuid: '102-W', oldPort: '0', newPort: '0', recoup: true, status: 'pending' });
  });

  it('keeps overrides when rebuilt, rejects bad Port/Net, and drops a voided replacement', async () => {
    const { db, pid, ep } = await setup();
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-10', technician: 'T', outcome: 'completed', events: [
      { endpointId: ep('102'), action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX1' }] }] });
    const [row] = await buildIdUpdate(db, r.visitId);
    const edit = { id: row.id, newMiuid: '102-W', newPort: '2', newNet: '0', systemType: 'TW.COM', meterType: 'Test Poly' };
    await expect(saveIdOverrides(db, r.visitId, [{ ...edit, newPort: 'x' }])).rejects.toThrow(/whole number/);
    await saveIdOverrides(db, r.visitId, [edit]);
    expect((await buildIdUpdate(db, r.visitId))[0]).toMatchObject({ newPort: '2', systemType: 'TW.COM' });
    await voidEvent(db, r.eventIds[0], 'wrong unit', null);
    expect(await buildIdUpdate(db, r.visitId)).toHaveLength(0);
  });

  it('exports a workbook in the template layout with working formulas, and freezes exported rows', async () => {
    const { db, pid, ep } = await setup();
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-10', technician: 'T', outcome: 'completed', events: [
      { endpointId: ep('102'), action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX1' }] }] });
    await buildIdUpdate(db, r.visitId);
    const bytes = await idUpdateXlsx(db, r.visitId, { property: 'Test Property', classId: CLASS_ID, visitedOn: '2026-11-10', technician: 'T' });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Changes', 'AMR recoup', 'Read me']);
    const ws = wb.getWorksheet('Changes')!;
    expect(ws.getCell('K3').value).toBe('NEWTX1'); expect(ws.getCell('L3').value).toBe('102-W'); expect(ws.getCell('B3').value).toBe('0001');
    expect((ws.getCell('P3').value as { formula: string }).formula).toBe('L3&K3&M3&N3');
    expect(wb.getWorksheet('AMR recoup')!.getCell('G2').value).toBe('2026-11-10');
    expect(await markExported(db, r.visitId)).toBe(1);
    await buildIdUpdate(db, r.visitId);                                   // rebuilding does not touch exported rows
    expect((await idUpdateRows(db, r.visitId))[0].status).toBe('exported');
    await expect(saveIdOverrides(db, r.visitId, [{ id: (await idUpdateRows(db, r.visitId))[0].id, newMiuid: null, newPort: '0', newNet: '0', systemType: null, meterType: null }])).rejects.toThrow(/exported/);
  });

  it('builds the billing key the way the template does', () => expect(meterKey('102-W', 'AB12', '0', '0')).toBe('102-WAB1200'));
});
