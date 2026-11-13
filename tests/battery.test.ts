import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { buildDemo } from '../src/dev/demo';
import { batteryLow } from '../src/parsers/cim';
import { lowBatteryDevices, lowBatteryReport, lowBatteryXlsx, PM_DESCRIPTION } from '../src/service/battery';
import { auditLines } from '../src/queries/audit';
import { latestAuditBatch } from '../src/service/unitstatus';
import { todayQueues } from '../src/queries/today';

describe('battery column parsing', () => {
  it('reads words and yes/no', () => {
    expect(batteryLow('Low')).toBe(true); expect(batteryLow('LOW BATTERY')).toBe(true); expect(batteryLow('Replace')).toBe(true);
    expect(batteryLow('OK')).toBe(false); expect(batteryLow('Good')).toBe(false); expect(batteryLow('yes')).toBe(true); expect(batteryLow('no')).toBe(false);
    expect(batteryLow(null)).toBe(null); expect(batteryLow('??')).toBe(null);
  });
});

describe('low battery -> preventative maintenance', () => {
  it('flags low-battery transmitters on the audit, the Proposal, the report and Today', async () => {
    const db = await openDb();
    await buildDemo(db);
    const cedar = (await db.query<{ id: string; name: string; class_id: string }>(`SELECT id, name, class_id FROM property WHERE class_id='9910003'`)).rows[0];
    const low = await lowBatteryDevices(db, { propertyId: cedar.id });
    expect(low.length).toBe(3);
    const b = (await latestAuditBatch(db, cedar.id))!;
    const lines = await auditLines(db, b.id, '2026-11-13');
    expect(lines.filter((l) => l.lowBattery).length).toBe(3);
    expect(lines.filter((l) => l.lowBattery).every((l) => l.code === 'OK')).toBe(true);
    const pm = (await db.query<{ n: string }>(
      `SELECT count(*) n FROM document_line dl JOIN document_version v ON v.id=dl.version_id JOIN document d ON d.id=v.document_id WHERE d.property_id=$1 AND dl.description=$2 AND dl.issue_code='PM'`, [cedar.id, PM_DESCRIPTION])).rows[0];
    expect(Number(pm.n)).toBe(3);
    const rep = await lowBatteryReport(db, cedar.id, '2026-11-13');
    expect(rep.length).toBe(3);
    const x = await lowBatteryXlsx(rep, { name: cedar.name, classId: cedar.class_id }, '2026-11-13');
    expect(x.length).toBeGreaterThan(1000);
    const q = await todayQueues(db, '2026-11-13');
    expect(q.lowBattery.map((z) => z.property)).toEqual(['Cedar Court']);
    // Other properties' imports have no battery column, so nothing is flagged there.
    const maple = (await db.query<{ id: string }>(`SELECT id FROM property WHERE class_id='9910001'`)).rows[0];
    expect((await lowBatteryDevices(db, { propertyId: maple.id })).length).toBe(0);
  }, 120000);
});
