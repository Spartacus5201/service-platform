import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { parseFile } from '../src/parsers';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { synthUnits, synthAutoAudit, synthAmrStatus } from '../src/dev/synthetic';
import { createDocument } from '../src/documents/build';
import { lowBatteryReport, PM_DESCRIPTION } from '../src/service/battery';
import type { CimParse } from '../src/parsers/cim';

const enc = (s: string) => new TextEncoder().encode(s);
const n = (u: string | null) => String(Number(u));   // audit labels are zero-padded

describe('Next Century AMR Status Report', () => {
  it('parses battery percent, model and check-in from the CSV', async () => {
    const units = synthUnits(1, 3, 5);
    const p = (await parseFile(enc(synthAmrStatus(units, { [units[0].unit]: 1 }, undefined, [units[0].unit])))) as CimParse;
    expect(p.kind).toBe('cim_nextcentury');
    expect(p.devices).toHaveLength(units.length);
    expect(p.devices[0]).toMatchObject({ batteryLevel: 1, transmitterModel: 'TR201', serviceCode: 'WS', hardwareId: units[0].tx });
    expect(p.devices[1].batteryLevel).toBe(100);
    expect(p.devices[0].lastCheckIn).toBe('2026-09-01T12:00:00.000Z');
  });

  it('prices a dead-battery NT as a battery and adds PM lines for low batteries still reading', async () => {
    const db = await openDb();
    const units = synthUnits(1, 6, 9);
    const [nt, pm1, pm25, ok50] = units.map((u) => u.unit);
    const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ('9900001','Battery Test') RETURNING id`)).rows[0].id;
    const over = Object.fromEntries(units.map((u) => [u.unit, { code: u.unit === nt ? 'NT' : 'OK' }]));
    const audit = await importParsed(db, pid, parseAutoAudit(synthAutoAudit(units, { override: over })), { createMissing: true });
    await importParsed(db, pid, (await parseFile(enc(synthAmrStatus(units, { [nt]: 1, [pm1]: 1, [pm25]: 25, [ok50]: 50 }, undefined, [nt])))) as CimParse);

    const rep = await lowBatteryReport(db, pid, '2026-11-13');
    expect(rep.map((r) => n(r.unit)).sort()).toEqual([nt, pm1, pm25].sort());      // 50% is not low at the default 25% threshold
    expect(rep.find((r) => n(r.unit) === nt)!.stopped).toBe(true);
    expect(rep.find((r) => n(r.unit) === pm1)!.stopped).toBe(false);
    expect(rep.every((r) => r.batteryPrice === 9.1)).toBe(true);

    const d = await createDocument(db, { propertyId: pid, type: 'WA', title: 'Batteries', createdOn: '2026-11-13', fromAuditBatch: audit.batchId! });
    const lines = (await db.query<{ unit: string; issue_code: string; description: string; unit_price: string; labor_price: string; component: string }>(
      `SELECT u.current_label unit, dl.issue_code, dl.description, dl.unit_price::text, dl.labor_price::text, dl.component FROM document_line dl
         JOIN endpoint e ON e.id=dl.endpoint_id JOIN unit u ON u.id=e.unit_id WHERE dl.version_id=$1`, [d.versionId])).rows;
    const ntLine = lines.find((l) => n(l.unit) === nt)!;
    expect(ntLine).toMatchObject({ issue_code: 'NT', component: 'battery', unit_price: '9.10', labor_price: '85.00' });
    const pmLines = lines.filter((l) => l.issue_code === 'PM');
    expect(pmLines.map((l) => n(l.unit))).toEqual([pm1]);             // 25% is flagged on the audit, only 1% goes on the WA
    expect(pmLines.every((l) => l.description === PM_DESCRIPTION && l.unit_price === '9.10' && l.component === 'battery')).toBe(true);

    // A catalog battery for the transmitter model overrides the default price.
    await db.query(`INSERT INTO catalog_item (kind,component,name,price,effective_from,active) VALUES ('part','battery','Battery for TR201',11.25,'2026-01-01',true)`);
    expect((await lowBatteryReport(db, pid, '2026-11-13'))[0].batteryPrice).toBe(11.25);
  }, 120000);
});
