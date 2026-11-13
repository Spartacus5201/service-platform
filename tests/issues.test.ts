import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { synthUnits, synthAutoAudit } from '../src/dev/synthetic';
import { openIssues, addUnitForIssue, dismissIssue, IssueError } from '../src/import/issues';
import { recordVisit } from '../src/service/record';

describe('import problems', () => {
  it('keeps unmatched units and ID mismatches open until resolved or dismissed', async () => {
    const db = await openDb();
    const units = synthUnits(1, 4, 3);
    const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ('9900001','Issues') RETURNING id`)).rows[0].id;
    // First audit creates three of the four units.
    await importParsed(db, pid, parseAutoAudit(synthAutoAudit(units.slice(0, 3))), { createMissing: true });
    // Second audit: the fourth unit is unknown, and the first unit reports a different transmitter.
    const a = units[0];
    await importParsed(db, pid, parseAutoAudit(synthAutoAudit(units, { d1: '11/02/2026', d2: '11/12/2026', override: { [a.unit]: { tx: 'SWAPPED-1' } } })));
    let open = await openIssues(db, pid);
    expect(open.map((i) => i.kind).sort()).toEqual(['id_mismatch', 'unmatched_unit']);
    // Importing the same problems again does not duplicate them.
    await importParsed(db, pid, parseAutoAudit(synthAutoAudit(units, { d1: '11/03/2026', d2: '11/12/2026', override: { [a.unit]: { tx: 'SWAPPED-1' } } })));
    expect((await openIssues(db, pid)).length).toBe(2);

    const missing = open.find((i) => i.kind === 'unmatched_unit')!;
    await addUnitForIssue(db, missing.id, null);
    await expect(addUnitForIssue(db, missing.id, null)).rejects.toThrow(IssueError);

    // Recording the swap resolves the mismatch by itself.
    const ep = (await db.query<{ id: string }>(`SELECT e.id FROM endpoint e JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id WHERE b.property_id=$1 AND ltrim(u.current_label,'0')=$2`, [pid, a.unit])).rows[0].id;
    await recordVisit(db, { propertyId: pid, visitedOn: '2026-11-12', outcome: 'completed', events: [{ endpointId: ep, action: 'replace', issueCode: 'NT', replacements: [{ kind: 'transmitter', newHardwareId: 'SWAPPED-1' }] }] });
    open = await openIssues(db, pid);
    expect(open).toHaveLength(0);

    // Dismiss needs a reason.
    await importParsed(db, pid, parseAutoAudit(synthAutoAudit([...units, { ...units[3], unit: '999', tx: 'X999' }], { d1: '11/04/2026', d2: '11/12/2026', override: { [a.unit]: { tx: 'SWAPPED-1' } } })));
    const left = await openIssues(db, pid);
    expect(left).toHaveLength(1);
    await expect(dismissIssue(db, left[0].id, '', null)).rejects.toThrow(IssueError);
    await dismissIssue(db, left[0].id, 'Common area meter', null);
    expect(await openIssues(db, pid)).toHaveLength(0);
  }, 120000);
});
