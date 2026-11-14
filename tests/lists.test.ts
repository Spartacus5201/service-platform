// Editable lists: built-in items keep their behaviour, people change wording and add items that work like a
// built-in, and nothing is deleted.
import { describe, it, expect, beforeAll } from 'vitest';
import { world, count, type World } from './helpers';
import { BUILTIN_LISTS, LIST_DEFS, loadLists, saveListItem, restoreListItem, choices } from '../src/lists/lists';
import { auditLines } from '../src/queries/audit';
import { recordVisit } from '../src/service/record';
import { closeoutData } from '../src/service/closeout';
import { suggestComment } from '../src/service/phrases';
import { getSystemNotes, saveSystemNotes } from '../src/documents/systemnotes';

let w: World;
beforeAll(async () => { w = await world(); }, 60000);

describe('built-in lists', () => {
  it('every list has items, unique codes, and works-like targets that are built-in', () => {
    for (const d of LIST_DEFS) {
      expect([d.key, d.builtins.length > 0]).toEqual([d.key, true]);
      expect(new Set(d.builtins.map((b) => b.code)).size).toBe(d.builtins.length);
      for (const c of d.worksLikeOf ?? []) expect(d.builtins.map((b) => b.code)).toContain(c);
    }
  });
  it('an empty table reads as shipped', async () => {
    const l = await loadLists(w.db);
    expect(l.label('visit_result', 'no_fault_found')).toBe('No fault found');
    expect(l.items('visit_action').map((i) => i.code)).toEqual(BUILTIN_LISTS.items('visit_action').map((i) => i.code));
    expect(l.label('audit_code', 'zz')).toBe('zz');                 // not on the list: shown as stored
  });
  it('the shipped wording is the same as before lists existed', () => {
    expect(suggestComment({ issueCode: 'NT', result: 'replaced', newTxId: '123', replacedKinds: ['transmitter'] }))
      .toBe('The transmitter was not sending readings. We replaced the transmitter (new transmitter ID 123). The unit should report normally on the next read cycle.');
  });
});

describe('changing and adding', () => {
  it('rewording a built-in changes the drafted client comment; restore puts it back', async () => {
    await saveListItem(w.db, null, { list: 'audit_code', code: 'NT', label: 'Not transmitting', wording: 'The transmitter had stopped reporting.', active: true });
    const ep = await w.ep('102');
    const v = (await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-11-10', technician: 'T', outcome: 'completed', events: [{ endpointId: ep, action: 'inspect_test', issueCode: 'NT' }] })).visitId;
    expect((await closeoutData(w.db, v)).units[0].suggested).toMatch(/^The transmitter had stopped reporting\. We inspected/);
    await restoreListItem(w.db, null, 'audit_code', 'NT');
    expect((await closeoutData(w.db, v)).units[0].suggested).toMatch(/^The transmitter was not sending readings\./);
    expect(await count(w.db, `SELECT count(*) n FROM audit_log WHERE entity='list_item' AND entity_id='audit_code:NT'`)).toBe(2);
  });

  it('an added audit code is judged as the code it works like', async () => {
    await saveListItem(w.db, null, { list: 'audit_code', newCode: 'nr', label: 'Not reporting', worksLike: 'NT', wording: 'The unit had stopped reporting.', active: true });
    await w.db.query(`UPDATE audit_reading SET audit_result='NR' WHERE import_batch_id=$1 AND endpoint_id=$2`, [w.batchId, await w.ep('101')]);
    const l = (await auditLines(w.db, w.batchId, '2026-11-13')).find((x) => x.unit.trim() === '101')!;
    expect([l.code, l.ruleCode, l.recommendation.action, l.recommendation.component]).toEqual(['NR', 'NT', 'Needs Service', 'transmitter']);
    // retired: back to unrecognised, still readable
    await saveListItem(w.db, null, { list: 'audit_code', code: 'NR', label: 'Not reporting', worksLike: 'NT', active: false });
    const again = (await auditLines(w.db, w.batchId, '2026-11-13')).find((x) => x.unit.trim() === '101')!;
    expect(again.recommendation.action).toBe('Unrecognized');
    expect((await loadLists(w.db)).label('audit_code', 'NR')).toBe('Not reporting');
  });

  it('an added action and result are stored as the built-in they work like, and shown as picked', async () => {
    await saveListItem(w.db, null, { list: 'visit_action', label: 'Battery swap', worksLike: 'repair', active: true });
    await saveListItem(w.db, null, { list: 'visit_result', label: 'Battery replaced', worksLike: 'repaired', wording: 'We replaced the battery.', active: true });
    const l = await loadLists(w.db);
    expect(l.pick('visit_action', 'battery_swap')).toEqual({ code: 'repair', item: 'battery_swap' });
    expect(l.pick('visit_action', 'repair')).toEqual({ code: 'repair', item: null });
    expect(l.pick('visit_action', 'nonsense')).toBeNull();
    const v = (await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-11-11', technician: 'T', outcome: 'completed',
      events: [{ endpointId: await w.ep('103'), action: 'repair', actionItem: 'battery_swap', result: 'repaired', resultItem: 'battery_replaced' }] })).visitId;
    const u = (await closeoutData(w.db, v)).units[0];
    expect([u.action, u.actionLabel, u.result, u.resultLabel]).toEqual(['repair', 'Battery swap', 'repaired', 'Battery replaced']);
    expect(u.suggested).toBe('We replaced the battery.');
  });

  it('refuses what would break the workflow', async () => {
    await expect(saveListItem(w.db, null, { list: 'visit_outcome', label: 'Partly done', active: true })).rejects.toThrow(/cannot have items added/);
    await expect(saveListItem(w.db, null, { list: 'audit_code', code: 'NT', label: 'Not transmitting', active: false })).rejects.toThrow(/cannot be retired/);
    await expect(saveListItem(w.db, null, { list: 'visit_action', label: 'Swap meter', worksLike: 'replace', active: true })).rejects.toThrow(/works like/);
    await expect(saveListItem(w.db, null, { list: 'visit_action', label: 'Repair', worksLike: 'repair', active: true })).rejects.toThrow(/already on the list/);
    await expect(saveListItem(w.db, null, { list: 'nope', label: 'x', active: true })).rejects.toThrow(/Unknown list/);
  });

  it('free lists: added items are offered and saved; a retired value a record holds is kept', async () => {
    await saveListItem(w.db, null, { list: 'milestone', label: 'Retrofit', active: true });
    const notes = await getSystemNotes(w.db, w.pid);
    await saveSystemNotes(w.db, w.pid, { ...notes, milestoneKind: 'Retrofit' }, {}, false, null);
    expect((await getSystemNotes(w.db, w.pid)).milestoneKind).toBe('Retrofit');
    await expect(saveSystemNotes(w.db, w.pid, { ...notes, milestoneKind: 'Made up' }, {}, false, null)).rejects.toThrow(/not on the milestone list/);
    await saveListItem(w.db, null, { list: 'milestone', code: 'Retrofit', label: 'Retrofit', active: false });
    const l = await loadLists(w.db);
    expect(choices(l, 'milestone').map(([c]) => c)).not.toContain('Retrofit');
    expect(choices(l, 'milestone', { keep: 'Retrofit' }).at(-1)).toEqual(['Retrofit', 'Retrofit (retired)']);
    await saveSystemNotes(w.db, w.pid, { ...notes, milestoneKind: 'Retrofit' }, {}, false, null);   // still saves
  });
});
