import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { parseCimInovonics } from '../src/parsers/cim';
import { auditLines } from '../src/queries/audit';
import { auditReportData, renderAuditPdf, periodText, auditCounts } from '../src/review/auditreport';
import { autoAuditGrid, cimInovGrid, CLASS_ID } from './fixtures';

async function setup() {
  const db = await openDb();
  const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'Test Property') RETURNING id`, [CLASS_ID])).rows[0].id;
  return { db, pid };
}

describe('audit report', () => {
  it('uses the real audit dates and says repeater data is missing when no CIM was imported', async () => {
    const { db, pid } = await setup();
    const r = await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
    const d = await auditReportData(db, r.batchId!, await auditLines(db, r.batchId!, '2026-11-06'));
    expect(periodText(d)).toBe('10/01/26 - 11/01/26');
    expect(d.repeaterDataAvailable).toBe(false);
    expect(d.collector).toBe('Not available');
    expect(auditCounts(d.lines).nt).toBe(1);
    const pdf = await renderAuditPdf(d);
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('lists repeaters with location and offline status from the CIM', async () => {
    const { db, pid } = await setup();
    const a = await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
    await importParsed(db, pid, parseCimInovonics(cimInovGrid()), { createMissing: true });
    const d = await auditReportData(db, a.batchId!, await auditLines(db, a.batchId!, '2026-11-06'));
    expect(d.repeaterDataAvailable).toBe(true);
    expect(d.repeaters[0]).toMatchObject({ location: 'Repeater 1', hardwareId: '1001', online: true });
    expect((await renderAuditPdf(d)).length).toBeGreaterThan(1000);
  });
});
