import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit, parseManualAudit } from '../src/parsers/audit';
import { parsePsr } from '../src/parsers/psr';
import { auditLines, needsAction, loadSettings } from '../src/queries/audit';
import { autoAuditGrid, manualAuditGrid, psrSheets, CLASS_ID } from './fixtures';

async function setup() {
  const db = await openDb();
  const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'Test Property') RETURNING id`, [CLASS_ID])).rows[0].id;
  return { db, pid };
}

describe('audit review lines', () => {
  it('applies the cascade with occupancy from the same import', async () => {
    const { db, pid } = await setup();
    const r = await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
    const lines = await auditLines(db, r.batchId!, '2026-11-06');
    const by = Object.fromEntries(lines.map((l) => [l.unit.trim(), l]));
    expect(by['000101'].recommendation.action).toBe('No action');           // OK
    expect(by['000102'].recommendation.action).toBe('Needs Service');       // NT
    expect(by['000103'].recommendation.action).toBe('No action');           // NI on a vacant unit
    expect(by['000104'].recommendation).toMatchObject({ action: 'Investigate', owner: 'property' });   // HIGH
    expect(by['000201'].recommendation.action).toBe('Investigate');         // LOW on an occupied unit
    expect(by['000202'].recommendation.action).toBe('Unrecognized');        // unknown code is surfaced
    expect(needsAction(lines)).toHaveLength(4);
  });

  it('treats a unit with no occupancy data as occupied and says so', async () => {
    const { db, pid } = await setup();
    const grid = autoAuditGrid().map((r) => r.slice());
    // strip the date range so no occupancy is parsed
    for (let i = 2; i < grid.length; i++) grid[i][19] = String(grid[i][19]).replace(/ \d\d\/\d\d\/\d\d-\d\d\/\d\d\/\d\d$/, '');
    const r = await importParsed(db, pid, parseAutoAudit(grid), { createMissing: true });
    const ni = (await auditLines(db, r.batchId!, '2026-11-06')).find((l) => l.unit.trim() === '000103')!;
    expect(ni.occupied).toBeNull();
    expect(ni.recommendation.action).toBe('Needs Service');
    expect(ni.recommendation.reason).toContain('occupancy unknown');
  });

  it('applies the INT rule from the Manual Audit', async () => {
    const { db, pid } = await setup();
    const r = await importParsed(db, pid, parseManualAudit(manualAuditGrid()), { createMissing: true });
    const lines = await auditLines(db, r.batchId!, '2026-11-06');
    const act = Object.fromEntries(lines.map((l) => [l.unit.trim(), l.recommendation.action]));
    expect(act).toMatchObject({ '000101': 'No action', '000102': 'Needs Service', '000103': 'No action', '000104': 'Needs Service', '000105': 'No action', '000106': 'No action' });   // 106: MANUAL via ManufacturerID, 1 read, so no flag
  });

  it('shows install-warranty coverage on a property we installed, none elsewhere', async () => {
    const { db, pid } = await setup();
    await importParsed(db, pid, parsePsr(psrSheets()), { createMissing: true });                    // completed 2026-03-12
    const r = await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
    const l = (await auditLines(db, r.batchId!, '2026-11-06'))[0];
    expect(l.coverage).toMatchObject({ laborCovered: true, partCovered: true });
    expect(l.coverage.install).toMatchObject({ status: 'Active', endsOn: '2027-03-12' });
    const later = (await auditLines(db, r.batchId!, '2027-06-01'))[0];
    expect(later.coverage.laborCovered).toBe(false);
  });

  it('a completed service visit gives labor-only coverage; unable-to-access does not', async () => {
    const { db, pid } = await setup();
    const r = await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
    const ep = (await db.query<{ id: string }>(`SELECT e.id FROM endpoint e JOIN unit u ON u.id=e.unit_id WHERE u.current_label='000102'`)).rows[0].id;
    const ep2 = (await db.query<{ id: string }>(`SELECT e.id FROM endpoint e JOIN unit u ON u.id=e.unit_id WHERE u.current_label='000104'`)).rows[0].id;
    const mk = async (date: string, outcome: string, endpoint: string) => {
      const v = (await db.query<{ id: string }>(`INSERT INTO visit (property_id,visited_on,outcome) VALUES ($1,$2,$3) RETURNING id`, [pid, date, outcome])).rows[0].id;
      await db.query(`INSERT INTO service_event (visit_id,endpoint_id,action) VALUES ($1,$2,'inspect_test')`, [v, endpoint]);
    };
    await mk('2026-08-01', 'completed', ep);
    await mk('2026-08-01', 'unable_to_access', ep2);
    const lines = await auditLines(db, r.batchId!, '2026-11-06');
    const by = Object.fromEntries(lines.map((l) => [l.unit.trim(), l.coverage]));
    expect(by['000102']).toMatchObject({ laborCovered: true, partCovered: false });
    expect(by['000104'].laborCovered).toBe(false);
  });

  it('reads thresholds from settings', async () => {
    const { db } = await setup();
    await db.query(`UPDATE setting SET value='7' WHERE key='int_read_threshold'`);
    expect((await loadSettings(db)).audit).toEqual({ intReadThreshold: 7, intStaleDays: 3 });
  });
});
