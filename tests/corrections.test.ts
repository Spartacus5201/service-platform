import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { recordVisit } from '../src/service/record';
import { closeoutData, approveCloseout, sendInvoiceSheet } from '../src/service/closeout';
import { correctEventWithReason, correctPartId, correctVisit, corrections, voidEvent } from '../src/service/correct';
import { autoAuditGrid, CLASS_ID } from './fixtures';

async function setup() {
  const db = await openDb();
  const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'Test Property') RETURNING id`, [CLASS_ID])).rows[0].id;
  await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
  const eps = (await db.query<{ id: string; unit: string }>(`SELECT e.id, u.current_label unit FROM endpoint e JOIN unit u ON u.id=e.unit_id`)).rows;
  const ep = (u: string) => eps.find((e) => e.unit.trim() === u)!.id;
  const visit = (events: Parameters<typeof recordVisit>[1]['events'], on = '2026-11-10') => recordVisit(db, { propertyId: pid, visitedOn: on, technician: 'T', outcome: 'completed', events });
  const active = async (e: string, kind: string) => (await db.query<{ hardware_id: string }>(
    `SELECT d.hardware_id FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=$1 AND d.kind=$2 AND i.removed_on IS NULL AND d.status='active'`, [e, kind])).rows[0]?.hardware_id;
  return { db, pid, ep, visit, active };
}

describe('corrections', () => {
  it('requires a reason and records who changed what', async () => {
    const { db, ep, visit } = await setup();
    const r = await visit([{ endpointId: ep('102'), action: 'inspect_test', issueCode: 'NT', notes: 'typo' }]);
    await expect(correctEventWithReason(db, r.eventIds[0], { notes: 'fixed' }, '  ', null)).rejects.toThrow(/why/);
    await correctEventWithReason(db, r.eventIds[0], { notes: 'fixed', result: 'repaired' }, 'Typo', null);
    const c = await closeoutData(db, r.visitId);
    expect(c.units).toHaveLength(1);
    expect(c.units[0]).toMatchObject({ techNotes: 'fixed', result: 'repaired' });
    const log = await corrections(db, r.visitId);
    expect(log[0]).toMatchObject({ reason: 'Typo' }); expect(log[0].summary).toContain('corrected');
  });

  it('keeps client wording through a correction and reopens approval', async () => {
    const { db, ep, visit } = await setup();
    const r = await visit([{ endpointId: ep('102'), action: 'inspect_test', issueCode: 'NT' }]);
    await db.query(`INSERT INTO event_note (service_event_id,client_comment) VALUES ($1,'Custom text')`, [r.eventIds[0]]);
    await approveCloseout(db, r.visitId, null);
    await correctEventWithReason(db, r.eventIds[0], { notes: 'x' }, 'why', null);
    const c = await closeoutData(db, r.visitId);
    expect(c.units[0].clientComment).toBe('Custom text'); expect(c.visit.status).toBe('draft');
  });

  it('voiding a replacement puts the old transmitter back', async () => {
    const { db, ep, visit, active } = await setup();
    const e = ep('102');
    const before = await active(e, 'transmitter');
    const r = await visit([{ endpointId: e, action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'WRONG' }] }]);
    expect(await active(e, 'transmitter')).toBe('WRONG');
    await voidEvent(db, r.eventIds[0], 'Entered on the wrong unit', null);
    expect(await active(e, 'transmitter')).toBe(before);
    expect((await closeoutData(db, r.visitId)).units).toHaveLength(0);
    await expect(voidEvent(db, r.eventIds[0], 'again', null)).rejects.toThrow(/already/);
    // the ID can be used again
    await visit([{ endpointId: e, action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'WRONG' }] }]);
  });

  it('fixes a mistyped replacement ID, refusing a duplicate', async () => {
    const { db, ep, visit, active } = await setup();
    const a = await visit([{ endpointId: ep('102'), action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'TX-AAA' }] }]);
    await visit([{ endpointId: ep('104'), action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'TX-BBB' }] }]);
    await expect(correctPartId(db, a.eventIds[0], 'TX-BBB', 'typo', null)).rejects.toThrow(/already active/);
    await correctPartId(db, a.eventIds[0], 'TX-AAB', 'typo', null);
    expect(await active(ep('102'), 'transmitter')).toBe('TX-AAB');
    expect((await corrections(db, a.visitId))[0].summary).toContain('TX-AAA');
  });

  it('a new visit date recalculates warranty coverage and moves install dates', async () => {
    const { db, pid, ep, visit } = await setup();
    await db.query(`UPDATE property SET installed_by_us=true, install_completed_on='2026-01-01' WHERE id=$1`, [pid]);
    const r = await visit([{ endpointId: ep('102'), action: 'replace', replacements: [{ kind: 'transmitter', newHardwareId: 'TXD' }] }], '2026-11-10');
    const cov = async () => (await db.query<{ labor_covered: boolean }>(`SELECT labor_covered FROM service_event WHERE id=$1`, [r.eventIds[0]])).rows[0].labor_covered;
    expect(await cov()).toBe(true);                                     // inside the install warranty
    await correctVisit(db, r.visitId, { visitedOn: '2028-06-01' }, 'Wrong date', null);
    expect(await cov()).toBe(false);                                    // after it
    const inst = (await db.query<{ installed_on: string }>(`SELECT installed_on::text FROM installation WHERE source_ref=$1`, [r.eventIds[0]])).rows[0];
    expect(inst.installed_on).toBe('2028-06-01');
  });

  it('blocks changes to invoiced work', async () => {
    const { db, ep, visit } = await setup();
    const r = await visit([{ endpointId: ep('102'), action: 'inspect_test', issueCode: 'NT' }]);
    await approveCloseout(db, r.visitId, null);
    await sendInvoiceSheet(db, r.visitId, null, '2026-11-11', null);
    await expect(voidEvent(db, r.eventIds[0], 'x', null)).rejects.toThrow(/invoiced/);
    await expect(correctVisit(db, r.visitId, { visitedOn: '2026-11-09' }, 'x', null)).rejects.toThrow(/invoiced/);
    await correctVisit(db, r.visitId, { technician: 'Other Tech' }, 'Wrong name', null);     // harmless fields stay editable
    expect((await closeoutData(db, r.visitId)).visit.technician).toBe('Other Tech');
  });
});
