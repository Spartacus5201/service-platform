import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { buildDemo } from '../src/dev/demo';
import { todayQueues } from '../src/queries/today';

describe('demo dataset and Today queues', () => {
  it('builds three properties with work in each queue', async () => {
    const db = await openDb();
    expect((await buildDemo(db)).properties).toBe(3);
    const q = await todayQueues(db, '2026-11-13');
    expect(q.draftNotes.map((x) => x.property)).toContain('Harbor View Lofts');
    expect(q.uninvoiced.map((x) => x.property)).toContain('Cedar Court');
    expect(q.idUpdates.map((x) => x.property)).toContain('Cedar Court');
    expect(q.failed.map((x) => x.property)).toContain('Maple Ridge Apartments');
    expect(q.units.length).toBeGreaterThan(0);
    // The fully worked property is invoiced and its ID update is no longer pending.
    expect(q.uninvoiced.map((x) => x.property)).not.toContain('Maple Ridge Apartments');
    expect(q.idUpdates.map((x) => x.property)).not.toContain('Maple Ridge Apartments');
  }, 120000);
});
