import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit, parseManualAudit } from '../src/parsers/audit';
import { parseCimInovonics } from '../src/parsers/cim';
import { recordVisit } from '../src/service/record';
import { buildIdUpdate, idUpdateRows } from '../src/service/idupdate';
import { verifyVisit, followUps } from '../src/service/verify';
import { autoAuditGrid, cimInovGrid, CLASS_ID, type UnitSpec } from './fixtures';

async function setup() {
  const db = await openDb();
  const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'Test Property') RETURNING id`, [CLASS_ID])).rows[0].id;
  // First audit: unit 102 NT, 104 NT. Window 10/01 - 11/01 (fixture dates).
  const units: UnitSpec[] = [{ bldg: '1', unit: '102', code: 'NT', occ: '05/10/25-02/28/25' }, { bldg: '1', unit: '104', code: 'NT', occ: '09/15/24-01/01/00' }];
  await importParsed(db, pid, parseAutoAudit(autoAuditGrid(units)), { createMissing: true });
  const eps = (await db.query<{ id: string; unit: string }>(`SELECT e.id, u.current_label unit FROM endpoint e JOIN unit u ON u.id=e.unit_id`)).rows;
  const ep = (u: string) => eps.find((e) => e.unit.trim() === u)!.id;
  return { db, pid, ep };
}
/** A later audit whose window starts after the visit, with chosen results per unit. */
function laterAudit(codes: Record<string, string>) {
  const g = autoAuditGrid(Object.entries(codes).map(([unit, code]) => ({ bldg: '1', unit, code, occ: '05/10/25-02/28/25' })));
  for (const r of g.slice(2)) { r[8] = '12/01/2026'; r[13] = '12/31/2026'; }    // Readdate2 / Column1: a window after the visit
  return g;
}

describe('verification', () => {
  it('is pending until later data arrives, then verified or failed by what the audit says', async () => {
    const { db, pid, ep } = await setup();
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-10', technician: 'T', outcome: 'completed', events: [
      { endpointId: ep('000102'), action: 'repair', issueCode: 'NT' }, { endpointId: ep('000104'), action: 'repair', issueCode: 'NT' }] });
    expect((await verifyVisit(db, r.visitId)).every((v) => v.status === 'pending')).toBe(true);
    await importParsed(db, pid, parseAutoAudit(laterAudit({ '102': 'OK', '104': 'NT' })), { createMissing: true });
    const v = await verifyVisit(db, r.visitId);
    expect(v.find((x) => x.unit.trim() === '000102')).toMatchObject({ status: 'verified' });
    expect(v.find((x) => x.unit.trim() === '000104')).toMatchObject({ status: 'failed' });
    expect((await followUps(db, pid)).map((x) => x.unit.trim())).toEqual(['000104']);
  });

  it('an audit window that started before the visit proves nothing', async () => {
    const { db, pid, ep } = await setup();
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-10-20', technician: 'T', outcome: 'completed', events: [{ endpointId: ep('000102'), action: 'repair', issueCode: 'NT' }] });
    const v = await verifyVisit(db, r.visitId);          // the setup audit ran 10/01 - 11/01 and says NT, but began before the visit
    expect(v[0].status).toBe('pending');
  });

  it('a unit that is not completed stays pending, and a vacant NI counts as fine', async () => {
    const { db, pid, ep } = await setup();
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-10', technician: 'T', outcome: 'unable_to_access', events: [{ endpointId: ep('000102'), action: 'inspect_test', issueCode: 'NT' }] });
    expect((await verifyVisit(db, r.visitId))[0].evidence).toContain('not completed');
  });

  it('flags a replaced transmitter whose old ID still appears, and confirms the ID update when the new ID shows up', async () => {
    const { db, pid, ep } = await setup();
    const old = (await db.query<{ h: string }>(`SELECT d.hardware_id h FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=$1 AND d.kind='transmitter'`, [ep('000102')])).rows[0].h;
    const r = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-10', technician: 'T', outcome: 'completed', events: [
      { endpointId: ep('000102'), action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX1' }] }] });
    await buildIdUpdate(db, r.visitId);
    // a later audit still carrying the old AMR id
    await importParsed(db, pid, parseAutoAudit(laterAudit({ '102': 'OK' })), { createMissing: true });
    const bad = (await verifyVisit(db, r.visitId))[0];
    expect(bad.status).toBe('failed'); expect(bad.evidence).toContain(old);
    expect((await idUpdateRows(db, r.visitId))[0].status).toBe('pending');
    // CIM check-in for the new ID arrives
    await db.query(`UPDATE audit_reading SET amr_id='NEWTX1' WHERE endpoint_id=$1 AND read_date_1 >= '2026-11-10'`, [ep('000102')]);
    await importParsed(db, pid, parseAutoAudit(laterAudit({ '102': 'OK' })), { createMissing: true, filename: 'again' });
    expect((await verifyVisit(db, r.visitId))[0].status).toBe('verified');
  });
});
