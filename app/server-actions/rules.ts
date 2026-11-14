'use server';
import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { today } from '@/src/server/dates';
import { requireCan } from '@/src/server/session';
import type { Rule, RuleTable } from '@/src/rules/audit';
import { discardDraft, getDraft, loadRules, saveDraft, saveRules, testRules } from '@/src/rules/table';
import { withError, withMsg } from '../ui';
import { s, msgOf, isRedirect, domainError } from './form';

const BACK = '/admin/rules';

/** The rule table the form describes: every code on the form, starting from the rules in force (or the draft). */
function fromForm(fd: FormData, base: RuleTable): RuleTable {
  const out: RuleTable = { ...base };
  for (const code of fd.getAll('code').map(String)) {
    if (s(fd, `mode_${code}`) === 'like') { delete out[code]; continue; }
    const side = (p: string) => ({ action: (s(fd, `${p}a_${code}`) ?? '') as Rule['occupied']['action'], owner: (s(fd, `${p}o_${code}`) || null) as Rule['occupied']['owner'], reason: s(fd, `${p}r_${code}`) ?? '' });
    out[code] = { component: (s(fd, `comp_${code}`) ?? 'none') as Rule['component'], method: (s(fd, `method_${code}`) ?? 'standard') as Rule['method'], occupied: side('o'), vacant: side('v') };
  }
  return out;
}

/** Store the form as the person's draft and show what it would change. */
export async function testRulesAction(fd: FormData) {
  const sess = await requireCan('rules.edit');
  try {
    const db = await getDb();
    await saveDraft(db, sess.userId, fromForm(fd, (await getDraft(db, sess.userId)) ?? await loadRules(db)));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError(BACK, msgOf(e))); throw e; }
  redirect(`${BACK}?tested=1#test`);
}

/** Save the tested draft. It is tested again here, so what is logged is what was saved. */
export async function saveRulesAction() {
  const sess = await requireCan('rules.edit');
  let changed: string[] = [];
  try {
    const db = await getDb();
    const draft = await getDraft(db, sess.userId);
    if (!draft) redirect(withError(BACK, 'Test the changes first.'));
    changed = await saveRules(db, sess.userId, await testRules(db, draft!, { asOf: today() }));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(withError(BACK, msgOf(e))); throw e; }
  redirect(withMsg(BACK, changed.length ? `Rules saved for ${changed.join(', ')}.` : 'Nothing was different; no change.'));
}

export async function discardRulesAction() {
  const sess = await requireCan('rules.edit');
  await discardDraft(await getDb(), sess.userId);
  redirect(withMsg(BACK, 'Draft discarded.'));
}
