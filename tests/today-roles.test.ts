// Today by role: each role sees the queues its permissions allow, in the order its role puts first, and
// technicians get their own visits and revisits instead of everyone's.
import { describe, it, expect, beforeAll } from 'vitest';
import { world, type World } from './helpers';
import { createUser, loadAccess } from '../src/auth/auth';
import { queuesFor, todayQueues, QUEUE_PERMS, DEFAULT_ORDER } from '../src/queries/today';
import { recordVisit } from '../src/service/record';
import { isOwnVisit } from '../src/jobs/own';

let w: World; const ids: Record<string, string> = {};
const access = async (key: string) => ({ ...(await loadAccess(w.db, ids[key])) });

beforeAll(async () => {
  w = await world();
  for (const r of ['admin', 'manager', 'coordinator', 'scheduler', 'technician', 'billing'])
    ids[r] = await createUser(w.db, { email: `${r}@t.io`, name: `Tess ${r}`, roles: [r], password: 'Password-1234', mustChangePassword: false });
  ids.both = await createUser(w.db, { email: 'both@t.io', name: 'Sam Both', roles: ['scheduler', 'technician'], password: 'Password-1234', mustChangePassword: false });
}, 60000);

describe('queuesFor', () => {
  it('every queue has a rule and a place in the default order', () => {
    expect(new Set(DEFAULT_ORDER)).toEqual(new Set(Object.keys(QUEUE_PERMS)));
  });
  it('each role sees what its permissions allow, its own work first', async () => {
    const tech = queuesFor(await access('technician'));
    expect(tech).toEqual(['myRevisits', 'myVisits']);
    const billing = queuesFor(await access('billing'));
    expect(billing).toEqual(['uninvoiced', 'invoiceNoRef']);
    const sched = queuesFor(await access('scheduler'));
    expect(sched.slice(0, 3)).toEqual(['notVisited', 'revisit', 'failed']);
    expect(sched).not.toContain('needsDocument');
    expect(sched).not.toContain('myVisits');            // sees every visit, so has the full queues
    const coord = queuesFor(await access('coordinator'));
    expect(coord[0]).toBe('needsDocument');
    expect(coord).not.toContain('uninvoiced');
    expect(queuesFor(await access('manager'))[0]).toBe('readyToClose');
    expect(queuesFor(await access('admin'))).toEqual([]);
  });
  it('several roles: the first role in the list order leads, nothing is shown twice', async () => {
    const both = queuesFor(await access('both'));
    expect(both.slice(0, 3)).toEqual(['notVisited', 'revisit', 'failed']);
    expect(new Set(both).size).toBe(both.length);
    expect(both).not.toContain('myVisits');             // scheduler sees all visits already
  });
  it('the grid decides: removing a permission removes the queue', async () => {
    await w.db.query(`DELETE FROM role_permission WHERE role_key='billing' AND permission='invoice.manage'`);
    expect(queuesFor(await access('billing'))).toEqual([]);
    await w.db.query(`INSERT INTO role_permission (role_key, permission, scope) VALUES ('billing','invoice.manage','all')`);
  });
});

describe('own visits', () => {
  let mine = ''; let other = '';
  beforeAll(async () => {
    const ep = await w.ep('102');                          // flagged by the audit
    mine = (await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-11-10', technician: 'Tess technician', outcome: 'unable_to_access', events: [{ endpointId: ep, action: 'inspect_test', result: 'unable_to_access' }] })).visitId;
    other = (await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-11-11', technician: 'Someone Else', outcome: 'completed', events: [{ endpointId: await w.ep('101'), action: 'inspect_test' }] })).visitId;
  }, 60000);
  it('a visit is the technician\'s when their name was typed, or they recorded it', async () => {
    expect(await isOwnVisit(w.db, mine, ids.technician)).toBe(true);
    expect(await isOwnVisit(w.db, other, ids.technician)).toBe(false);
    const byThem = (await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-11-12', technician: 'Helper', createdBy: ids.technician, outcome: 'completed', events: [{ endpointId: await w.ep('103'), action: 'inspect_test' }] })).visitId;
    expect(await isOwnVisit(w.db, byThem, ids.technician)).toBe(true);
  });
  it('the technician\'s Today lists only their visits and revisits', async () => {
    const order = queuesFor(await access('technician'));
    const q = await todayQueues(w.db, '2026-11-13', { only: order, userId: ids.technician });
    expect(q.myVisits.map((v) => v.visitId)).toContain(mine);
    expect(q.myVisits.map((v) => v.visitId)).not.toContain(other);
    expect(q.myRevisits.map((v) => v.visitId)).toEqual([mine]);
    expect(q.revisit).toEqual([]);                      // the shared queue is not worked out for them
    expect(q.uninvoiced).toEqual([]);
  });
  it('without `only`, every queue is worked out as before', async () => {
    const q = await todayQueues(w.db, '2026-11-13');
    expect(q.revisit.map((r) => r.visitId)).toContain(mine);
    expect(q.myVisits).toEqual([]);
  });
});
