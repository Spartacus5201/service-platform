import { describe, it, expect } from 'vitest';
import { world, count } from './helpers';
import { recordVisit, correctEvent, ServiceError } from '../src/service/record';
import { endpointHistory } from '../src/service/history';

describe('recording visits', () => {
  it('a completed testing visit starts labor warranty for the next visit', async () => {
    const { db, pid, ep } = await world();
    const e = await ep('102');
    const first = await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed', technician: 'Pat', events: [{ endpointId: e, action: 'inspect_test', issueCode: 'NT' }] });
    const e1 = (await db.query<{ labor_covered: boolean }>(`SELECT labor_covered FROM service_event WHERE id=$1`, [first.eventIds[0]])).rows[0];
    expect(e1.labor_covered).toBe(false);                                   // nothing covered the first visit
    const second = await recordVisit(db, { propertyId: pid, visitedOn: '2026-10-15', outcome: 'completed', events: [{ endpointId: e, action: 'repair', issueCode: 'NT' }] });
    const e2 = (await db.query<{ labor_covered: boolean; part_covered: boolean; coverage_basis: string[] }>(`SELECT labor_covered, part_covered, coverage_basis FROM service_event WHERE id=$1`, [second.eventIds[0]])).rows[0];
    expect(e2.labor_covered).toBe(true);
    expect(e2.part_covered).toBe(false);
    expect(e2.coverage_basis[0]).toContain('2027-08-01');
  });

  it('unable to access and unable to complete never start the clock', async () => {
    const { db, pid, ep } = await world();
    const e = await ep('104');
    await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'unable_to_access', events: [{ endpointId: e, action: 'other', notes: 'Dog' }] });
    await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-10', outcome: 'unable_to_complete', events: [{ endpointId: e, action: 'other' }] });
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-09-01', outcome: 'completed', events: [{ endpointId: e, action: 'repair' }] });
    expect((await db.query<{ labor_covered: boolean }>(`SELECT labor_covered FROM service_event WHERE id=$1`, [v.eventIds[0]])).rows[0].labor_covered).toBe(false);
  });

  it('install warranty covers parts and labor on the first visit at a property we installed', async () => {
    const { db, pid, ep } = await world({ installedByUs: true });
    const e = await ep('101');
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-06', outcome: 'completed',
      events: [{ endpointId: e, action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX1' }] }] });
    const r = (await db.query<{ labor_covered: boolean; part_covered: boolean }>(`SELECT labor_covered, part_covered FROM service_event WHERE id=$1`, [v.eventIds[0]])).rows[0];
    expect(r).toEqual({ labor_covered: true, part_covered: true });
  });
});

describe('replacements', () => {
  it('retires the old device, installs the new one, and starts its part warranty', async () => {
    const { db, pid, ep } = await world();
    const e = await ep('102');
    const old = (await db.query<{ hardware_id: string }>(`SELECT d.hardware_id FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=$1 AND d.kind='transmitter'`, [e])).rows[0].hardware_id;
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed',
      events: [{ endpointId: e, action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX2', model: 'T-100' }] }] });
    expect(v.warnings).toEqual([]);
    expect(await count(db, `SELECT count(*)::text n FROM device WHERE hardware_id=$1 AND status='retired'`, [old])).toBe(1);
    const cur = await db.query<{ hardware_id: string; installed_on: string; origin: string }>(
      `SELECT d.hardware_id, i.installed_on::text, i.origin FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=$1 AND d.kind='transmitter' AND i.removed_on IS NULL`, [e]);
    expect(cur.rows).toEqual([{ hardware_id: 'NEWTX2', installed_on: '2026-08-01', origin: 'service' }]);
    // second visit: the new transmitter is inside its part warranty
    const v2 = await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-06', outcome: 'completed',
      events: [{ endpointId: e, action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX3' }] }] });
    const r = (await db.query<{ labor_covered: boolean; part_covered: boolean }>(`SELECT labor_covered, part_covered FROM service_event WHERE id=$1`, [v2.eventIds[0]])).rows[0];
    expect(r).toEqual({ labor_covered: true, part_covered: true });
  });

  it('a replaced meter has no ID: it is a placeholder unless a serial is given', async () => {
    const { db, pid, ep } = await world();
    const e = await ep('103');
    await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed', events: [{ endpointId: e, action: 'replace', issueCode: 'NI', replacements: [{ kind: 'meter' }] }] });
    await recordVisit(db, { propertyId: pid, visitedOn: '2026-09-01', outcome: 'completed', events: [{ endpointId: e, action: 'replace', issueCode: 'NI', replacements: [{ kind: 'meter', newSerial: 'SER-9' }] }] });
    const m = await db.query<{ serial_number: string | null; is_placeholder: boolean; status: string }>(`SELECT d.serial_number, d.is_placeholder, d.status FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=$1 AND d.kind='meter' AND i.origin='service' ORDER BY i.installed_on`, [e]);
    expect(m.rows).toEqual([{ serial_number: null, is_placeholder: true, status: 'retired' }, { serial_number: 'SER-9', is_placeholder: false, status: 'active' }]);
  });

  it('refuses invalid combinations', async () => {
    const { db, pid, ep } = await world();
    const e = await ep('102');
    const base = { propertyId: pid, visitedOn: '2026-08-01' };
    await expect(recordVisit(db, { ...base, outcome: 'completed', events: [{ endpointId: e, action: 'replace' }] })).rejects.toThrow(ServiceError);
    await expect(recordVisit(db, { ...base, outcome: 'completed', events: [{ endpointId: e, action: 'repair', replacements: [{ kind: 'meter' }] }] })).rejects.toThrow(/replace event/);
    await expect(recordVisit(db, { ...base, outcome: 'unable_to_access', events: [{ endpointId: e, action: 'replace', replacements: [{ kind: 'meter' }] }] })).rejects.toThrow(/not completed/);
    await expect(recordVisit(db, { ...base, outcome: 'completed', events: [] })).rejects.toThrow();
    expect(await count(db, `SELECT count(*)::text n FROM visit`)).toBe(0);                  // nothing half-written
  });

  it('refuses a radio ID already active at the property, and rolls back', async () => {
    const { db, pid, ep } = await world();
    const e = await ep('102'); const e2 = await ep('104');
    await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed', events: [{ endpointId: e, action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'DUPTX' }] }] });
    await expect(recordVisit(db, { propertyId: pid, visitedOn: '2026-08-02', outcome: 'completed', events: [{ endpointId: e2, action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'DUPTX' }] }] })).rejects.toThrow(/already active/);
    expect(await count(db, `SELECT count(*)::text n FROM visit`)).toBe(1);
  });

  it('refuses an endpoint from another property', async () => {
    const { db, pid, ep } = await world();
    const other = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ('7','Other') RETURNING id`)).rows[0].id;
    await expect(recordVisit(db, { propertyId: other, visitedOn: '2026-08-01', outcome: 'completed', events: [{ endpointId: await ep('102'), action: 'repair' }] })).rejects.toThrow(/does not belong/);
    expect(pid).toBeTruthy();
  });
});

describe('corrections', () => {
  it('supersede the original, which stays in the table but leaves the history', async () => {
    const { db, pid, ep } = await world();
    const e = await ep('102');
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed', events: [{ endpointId: e, action: 'repair', issueCode: 'NT', notes: 'typo here' }] });
    const next = await correctEvent(db, v.eventIds[0], { notes: 'fixed note', issueCode: 'INT' });
    expect(await count(db, `SELECT count(*)::text n FROM service_event`)).toBe(2);
    const h = await endpointHistory(db, e, '2026-11-06');
    const svc = h.timeline.filter((t) => t.type === 'service');
    expect(svc).toHaveLength(1);
    expect(svc[0].detail).toMatchObject({ id: next, notes: 'fixed note', issue_code: 'INT', supersedes: v.eventIds[0] });
    await expect(correctEvent(db, v.eventIds[0], { notes: 'again' })).rejects.toThrow(/already corrected/);
  });
  it('replace events cannot be edited in place', async () => {
    const { db, pid, ep } = await world();
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed', events: [{ endpointId: await ep('102'), action: 'replace', replacements: [{ kind: 'meter' }] }] });
    await expect(correctEvent(db, v.eventIds[0], { notes: 'x' })).rejects.toThrow(/replace event/);
  });
  it('a correction does not double-count as a touch', async () => {
    const { db, pid, ep } = await world();
    const e = await ep('102');
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed', events: [{ endpointId: e, action: 'inspect_test' }] });
    await correctEvent(db, v.eventIds[0], { notes: 'n' });
    expect(await count(db, `SELECT count(DISTINCT v.id)::text n FROM service_event se JOIN visit v ON v.id=se.visit_id WHERE se.endpoint_id=$1`, [e])).toBe(1);
  });
});

describe('endpoint history', () => {
  it('merges visits, parts, readings and installs, newest first, with current coverage', async () => {
    const { db, pid, ep } = await world({ installedByUs: true });
    const e = await ep('102');
    await recordVisit(db, { propertyId: pid, visitedOn: '2026-08-01', outcome: 'completed', technician: 'Pat', salesforceCase: '00012345',
      events: [{ endpointId: e, action: 'replace', issueCode: 'NT', readAtService: 1234, replacements: [{ kind: 'transmitter', newHardwareId: 'NEWTX9' }] }] });
    const h = await endpointHistory(db, e, '2026-11-06');
    const types = h.timeline.map((t) => t.type);
    expect(types).toContain('service'); expect(types).toContain('reading'); expect(types).toContain('install');
    expect([...h.timeline].map((t) => t.date)).toEqual([...h.timeline].map((t) => t.date).sort().reverse());
    const svc = h.timeline.find((t) => t.type === 'service')!;
    expect(svc.summary).toContain('replace (NT)');
    expect(svc.summary).toContain('-> NEWTX9');
    expect(svc.detail).toMatchObject({ salesforce_case: '00012345', technician: 'Pat', read_at_service: '1234' });
    expect(h.devices.filter((d) => d.removedOn === null && d.kind === 'transmitter')[0]).toMatchObject({ hardwareId: 'NEWTX9', origin: 'service' });
    expect(h.coverage).toMatchObject({ laborCovered: true });
    expect(h.coverage.part.status).toBe('Active');
  });
});
