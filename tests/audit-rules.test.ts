// Rules as a table: the built-in table gives today's answers, a change is a draft that is tested against the latest
// audits (and the reviewers' decisions) before it can be saved, and every save is logged.
import { describe, it, expect, beforeAll } from 'vitest';
import { world, count, type World } from './helpers';
import { createUser } from '../src/auth/auth';
import { DEFAULT_RULES, type RuleTable } from '../src/rules/audit';
import { checkRule, discardDraft, getDraft, loadRules, saveDraft, saveRules, testRules } from '../src/rules/table';
import { auditLines } from '../src/queries/audit';
import { setOverride } from '../src/review/overrides';
import { saveListItem } from '../src/lists/lists';

let w: World; let me = '';
const line = async (unit: string) => (await auditLines(w.db, w.batchId, '2026-11-13')).find((l) => l.unit.trim() === unit)!;
const ignoreHigh = (): RuleTable => ({ ...DEFAULT_RULES, HIGH: { ...DEFAULT_RULES.HIGH, occupied: { action: 'No action', owner: null, reason: 'High usage is the property\'s business' }, vacant: { action: 'No action', owner: null, reason: 'High usage is the property\'s business' } } });

beforeAll(async () => {
  w = await world();
  me = await createUser(w.db, { email: 'm@t.io', name: 'M', roles: ['manager'], password: 'Password-1234', mustChangePassword: false });
}, 60000);

describe('audit rules', () => {
  it('with nothing saved, the rules are the built-in table', async () => {
    expect(await loadRules(w.db)).toEqual(DEFAULT_RULES);
    expect((await line('104')).rules).toMatchObject({ action: 'Investigate', owner: 'property', component: 'meter' });
  });

  it('a draft is tested against the latest audits and the reviewers\' decisions', async () => {
    const l = await line('104');
    await setOverride(w.db, l.readingId, { action: 'No action', reason: 'tenant has a pool' }, me, l.rules);
    await saveDraft(w.db, me, ignoreHigh());
    const t = await testRules(w.db, (await getDraft(w.db, me))!, { asOf: '2026-11-13' });
    expect(t.codes).toEqual(['HIGH']);
    expect(t.changed.map((c) => [c.unit.trim(), c.before.action, c.after.action, c.reviewer])).toEqual([['104', 'Investigate', 'No action', 'No action']]);
    expect([t.reviewed, t.agreeBefore, t.agreeAfter]).toEqual([1, 0, 1]);
    expect((await line('104')).rules.action).toBe('Investigate');          // nothing changes until saved
  });

  it('saving applies the draft, logs it with the test, and clears the draft', async () => {
    const t = await testRules(w.db, (await getDraft(w.db, me))!, { asOf: '2026-11-13' });
    expect(await saveRules(w.db, me, t)).toEqual(['HIGH']);
    expect((await line('104')).rules).toMatchObject({ action: 'No action', reason: 'High usage is the property\'s business.' });
    expect(await getDraft(w.db, me)).toBeNull();
    const log = (await w.db.query<{ detail: { tested: { unitsChanged: number; agreeAfter: number } } }>(`SELECT detail FROM audit_log WHERE action='rules_changed'`)).rows;
    expect(log.map((x) => [x.detail.tested.unitsChanged, x.detail.tested.agreeAfter])).toEqual([[1, 1]]);
    await expect(saveRules(w.db, me, t)).rejects.toThrow(/no tested draft/);
  });

  it('saving the built-in rule again removes the saved row', async () => {
    await saveDraft(w.db, me, { ...(await loadRules(w.db)), HIGH: DEFAULT_RULES.HIGH });
    await saveRules(w.db, me, await testRules(w.db, (await getDraft(w.db, me))!, { asOf: '2026-11-13' }));
    expect(await count(w.db, `SELECT count(*) n FROM audit_rule`)).toBe(0);
    expect(await loadRules(w.db)).toEqual(DEFAULT_RULES);
  });

  it('an added code follows the code it works like until it gets its own rule', async () => {
    await saveListItem(w.db, null, { list: 'audit_code', newCode: 'NR', label: 'Not reporting', worksLike: 'NT', active: true });
    await w.db.query(`UPDATE audit_reading SET audit_result='NR' WHERE import_batch_id=$1 AND endpoint_id=$2`, [w.batchId, await w.ep('101')]);
    expect((await line('101')).rules.action).toBe('Needs Service');
    const own: RuleTable = { ...(await loadRules(w.db)), NR: { ...DEFAULT_RULES.NT, ...{ occupied: { action: 'Investigate', owner: 'service coordinator', reason: 'Check the gateway first' }, vacant: { action: 'Investigate', owner: 'service coordinator', reason: 'Check the gateway first' } } } };
    await saveDraft(w.db, me, own);
    await saveRules(w.db, me, await testRules(w.db, (await getDraft(w.db, me))!, { asOf: '2026-11-13' }));
    expect((await line('101')).rules).toMatchObject({ action: 'Investigate', owner: 'service coordinator', component: 'transmitter' });
    expect((await line('101')).ruleCode).toBe('NT');                     // wording still follows NT
  });

  it('refuses rules that do not make sense, and keeps every built-in code', async () => {
    expect(() => checkRule('X', { ...DEFAULT_RULES.NT, occupied: { action: 'Fix it' as never, owner: null, reason: 'x' } })).toThrow(/unknown action/);
    expect(() => checkRule('X', { ...DEFAULT_RULES.NT, vacant: { action: 'No action', owner: null, reason: '  ' } })).toThrow(/give the reason/);
    const { NEG: _, ...noNeg } = await loadRules(w.db);
    await saveDraft(w.db, me, noNeg);
    await expect(saveRules(w.db, me, await testRules(w.db, noNeg, { asOf: '2026-11-13' }))).rejects.toThrow(/built-in code and keeps a rule/);
    await discardDraft(w.db, me);
  });
});
