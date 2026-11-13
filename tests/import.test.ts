import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../src/db';
import { importParsed, purgeExpiredImports, ImportError } from '../src/import/commit';
import { parseAutoAudit, parseManualAudit } from '../src/parsers/audit';
import { parseCimNextCentury, parseCimInovonics } from '../src/parsers/cim';
import { parsePsr } from '../src/parsers/psr';
import { autoAuditGrid, manualAuditGrid, cimNextGrid, cimInovGrid, psrSheets, CLASS_ID } from './fixtures';

let db: Db;
let pid: string;

const count = async (sql: string, p: unknown[] = []) => Number((await db.query<{ n: string }>(sql, p)).rows[0].n);

beforeEach(async () => {
  db = await openDb();
  pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'Test Property') RETURNING id`, [CLASS_ID])).rows[0].id;
});

describe('Auto Audit import', () => {
  it('creates the registry on a first import and stores readings', async () => {
    const r = await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
    expect(r).toMatchObject({ readings: 6, unitsCreated: 6, duplicate: false });
    expect(await count(`SELECT count(*)::text n FROM endpoint`)).toBe(6);
    expect(await count(`SELECT count(*)::text n FROM audit_reading`)).toBe(6);
    // one placeholder meter and one transmitter per endpoint
    expect(await count(`SELECT count(*)::text n FROM device WHERE kind='meter' AND is_placeholder`)).toBe(6);
    expect(await count(`SELECT count(*)::text n FROM device WHERE kind='transmitter'`)).toBe(6);
  });

  it('stores occupancy: vacant unit has no move-in', async () => {
    await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
    const u = await db.query<{ current_label: string; move_in_on: string | null; prior_move_out_on: string | null }>(
      `SELECT current_label, move_in_on::text, prior_move_out_on::text FROM unit ORDER BY current_label`);
    const by = Object.fromEntries(u.rows.map((x) => [x.current_label, x]));
    expect(by['000101'].move_in_on).toBe('2022-03-01');
    expect(by['000101'].prior_move_out_on).toBeNull();
    expect(by['000103'].move_in_on).toBeNull();                  // 01/01/00 first date = vacant
    expect(by['000102'].prior_move_out_on).toBe('2025-02-28');
  });

  it('re-importing the same bytes changes nothing', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const p = parseAutoAudit(autoAuditGrid());
    await importParsed(db, pid, p, { createMissing: true, fileBytes: bytes });
    const again = await importParsed(db, pid, p, { createMissing: true, fileBytes: bytes });
    expect(again.duplicate).toBe(true);
    expect(await count(`SELECT count(*)::text n FROM audit_reading`)).toBe(6);
  });

  it('refuses a file for another property', async () => {
    await db.query(`UPDATE property SET class_id='0000002' WHERE id=$1`, [pid]);
    await expect(importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true })).rejects.toThrow(ImportError);
  });

  it('reports unmatched units instead of creating them when createMissing is off', async () => {
    const r = await importParsed(db, pid, parseAutoAudit(autoAuditGrid()));
    expect(r.unmatched).toHaveLength(6);
    expect(r.readings).toBe(0);
    expect(await count(`SELECT count(*)::text n FROM unit`)).toBe(0);
  });

  it('matches existing units across zero-padded and plain labels', async () => {
    await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
    const r = await importParsed(db, pid, parseCimNextCentury(cimNextGrid()));      // labels "1"/"101"
    expect(r.unmatched).toEqual([]);                                                 // all three units found by alias
    expect(r.idChanges).toHaveLength(3);                                             // ...and compared with the IDs the audit recorded
    expect(r.checkins).toBe(2);                                                      // repeaters only: changed IDs wait for review
  });
});

describe('occupancy-only import', () => {
  it('updates move-in dates and ignores reads and AuditResult', async () => {
    const r = await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true, as: 'occupancy' });
    expect(r).toMatchObject({ kind: 'occupancy', readings: 0, occupancyUpdated: 6 });
    expect(await count(`SELECT count(*)::text n FROM audit_reading`)).toBe(0);
    expect(await count(`SELECT count(*)::text n FROM unit WHERE move_in_on IS NULL`)).toBe(1);
  });
  it('can sit alongside a normal audit of the same bytes', async () => {
    const bytes = new Uint8Array([9, 9]);
    const p = parseAutoAudit(autoAuditGrid());
    await importParsed(db, pid, p, { createMissing: true, fileBytes: bytes });
    const occ = await importParsed(db, pid, p, { as: 'occupancy', fileBytes: bytes });
    expect(occ.duplicate).toBe(false);
  });
});

describe('Manual Audit import', () => {
  it('flags manual-read endpoints and stores ReadCount', async () => {
    await importParsed(db, pid, parseManualAudit(manualAuditGrid()), { createMissing: true });
    expect(await count(`SELECT count(*)::text n FROM endpoint WHERE is_manual_read`)).toBe(3);
    const r = await db.query<{ read_count: number }>(`SELECT read_count FROM audit_reading ORDER BY read_count`);
    expect(r.rows.map((x) => x.read_count)).toEqual([0, 1, 2, 4, 12, 32]);
  });
});

describe('CIM import', () => {
  it('records repeaters at the property and transmitters at endpoints', async () => {
    const r = await importParsed(db, pid, parseCimNextCentury(cimNextGrid()), { createMissing: true });
    expect(r).toMatchObject({ devices: 5, checkins: 5, unitsCreated: 3 });
    expect(await count(`SELECT count(*)::text n FROM installation i JOIN device d ON d.id=i.device_id WHERE d.kind='repeater' AND i.endpoint_id IS NULL`)).toBe(2);
  });
  it('a second CIM keeps one device per radio ID and adds check-ins', async () => {
    await importParsed(db, pid, parseCimNextCentury(cimNextGrid()), { createMissing: true });
    const second = await importParsed(db, pid, parseCimNextCentury(cimNextGrid({ zenner: true })), { createMissing: true });
    expect(second.devices).toBe(0);
    expect(await count(`SELECT count(*)::text n FROM device WHERE kind='transmitter'`)).toBe(3);
    expect(await count(`SELECT count(*)::text n FROM device_checkin`)).toBe(10);
  });
  it('Inovonics stores health flags', async () => {
    await importParsed(db, pid, parseCimInovonics(cimInovGrid()), { createMissing: true });
    expect(await count(`SELECT count(*)::text n FROM device_checkin WHERE tamper IS TRUE`)).toBe(1);
    expect(await count(`SELECT count(*)::text n FROM device_checkin WHERE low_battery IS TRUE`)).toBe(1);
    expect(await count(`SELECT count(*)::text n FROM endpoint WHERE service_code='GS'`)).toBe(1);
  });
  it('flags a changed transmitter ID instead of silently overwriting it', async () => {
    await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });      // AMR0.. IDs
    const r = await importParsed(db, pid, parseCimNextCentury(cimNextGrid()));                    // TX0001.. IDs
    expect(r.idChanges.length).toBe(3);
    expect(await count(`SELECT count(*)::text n FROM device WHERE kind='transmitter'`)).toBe(6);   // nothing overwritten or added
    expect(r.idChanges[0]).toMatchObject({ was: 'AMR0', now: 'TX000101' });
  });
});

describe('PSR import', () => {
  it('anchors the install warranty and records install-project devices', async () => {
    const r = await importParsed(db, pid, parsePsr(psrSheets()), { createMissing: true });
    const p = await db.query<{ installed_by_us: boolean; install_completed_on: string }>(`SELECT installed_by_us, install_completed_on::text FROM property WHERE id=$1`, [pid]);
    expect(p.rows[0]).toEqual({ installed_by_us: true, install_completed_on: '2026-03-12' });
    expect(r.devices).toBe(4);                                                  // collector, repeater, 2 transmitters
    expect(await count(`SELECT count(*)::text n FROM installation WHERE origin='install_project' AND installed_on IS NOT NULL`)).toBeGreaterThanOrEqual(6);
  });
  it('lets a PSR repeater and a CIM repeater meet on one device', async () => {
    const psr = psrSheets();
    await importParsed(db, pid, parsePsr(psr), { createMissing: true });
    const cim = cimNextGrid(); cim[5][0] = 'REP001';
    await importParsed(db, pid, parseCimNextCentury(cim), { createMissing: true });
    expect(await count(`SELECT count(*)::text n FROM device WHERE kind='repeater' AND hardware_id='REP001'`)).toBe(1);
  });
});

describe('retention', () => {
  it('discards raw files after 180 days but keeps parsed readings', async () => {
    await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true, fileBytes: new Uint8Array([1, 2, 3]) });
    expect(await purgeExpiredImports(db)).toBe(0);                                      // too early
    const future = new Date(Date.now() + 181 * 86_400_000).toISOString().slice(0, 10);
    expect(await purgeExpiredImports(db, future)).toBe(1);
    expect(await count(`SELECT count(*)::text n FROM import_batch WHERE raw_file IS NULL AND raw_purged_at IS NOT NULL`)).toBe(1);
    expect(await count(`SELECT count(*)::text n FROM audit_reading`)).toBe(6);
  });
});
