// The audit rule table: built-in rules (src/rules/audit.ts) overlaid with the rows people saved.
// A change is proposed as a draft, tested against the latest real audits (what changes, and whether the rules
// agree more or less often with what reviewers decided), and only then saved. Every save is in the activity log.
import { UserError } from '../errors';
import type { Db, Q } from '../db';
import { DEFAULT_RULES, RULE_ACTIONS, RULE_COMPONENTS, RULE_OWNERS, type Recommendation, type Rule, type RuleTable } from './audit';

export class RuleError extends UserError {}

/** The rules in force: built-in, overlaid with saved rows. */
export async function loadRules(q: Q): Promise<RuleTable> {
  const rows = (await q.query<{ code: string; rule: Rule }>(`SELECT code, rule FROM audit_rule`)).rows;
  return { ...DEFAULT_RULES, ...Object.fromEntries(rows.map((r) => [r.code, r.rule])) };
}

/** Check a rule from a form or a file; returns it cleaned. */
export function checkRule(code: string, r: Rule): Rule {
  if (!RULE_COMPONENTS.includes(r.component)) throw new RuleError(`${code}: unknown part "${r.component}".`);
  if (r.method !== 'standard' && r.method !== 'intermittent') throw new RuleError(`${code}: unknown method "${r.method}".`);
  const side = (name: string, o: Rule['occupied']) => {
    if (!RULE_ACTIONS.includes(o.action)) throw new RuleError(`${code}: unknown action "${o.action}" when ${name}.`);
    if (o.owner && !RULE_OWNERS.includes(o.owner)) throw new RuleError(`${code}: unknown owner "${o.owner}" when ${name}.`);
    const reason = (o.reason ?? '').trim().replace(/[.\s]+$/, '');
    if (!reason) throw new RuleError(`${code}: give the reason shown when ${name}.`);
    if (reason.length > 200) throw new RuleError(`${code}: keep the reason under 200 characters.`);
    return { action: o.action, owner: o.owner || null, reason };
  };
  return { component: r.component, method: r.method, occupied: side('occupied', r.occupied), vacant: side('vacant', r.vacant) };
}

/** Rules compared by content (the database does not keep key order). */
const canon = (r: Rule | undefined) => r ? JSON.stringify([r.component, r.method, ...[r.occupied, r.vacant].map((o) => [o.action, o.owner ?? null, o.reason])]) : 'null';
export const sameRule = (a: Rule | undefined, b: Rule | undefined) => canon(a) === canon(b);

/** The rules that were in force at the end of a date. */
export async function rulesOn(q: Q, date: string): Promise<RuleTable> {
  const rows = (await q.query<{ code: string; rule: Rule | null }>(
    `SELECT DISTINCT ON (code) code, rule FROM audit_rule_version WHERE saved_at::date <= $1::date ORDER BY code, saved_at DESC, id DESC`, [date])).rows;
  const out: RuleTable = { ...DEFAULT_RULES };
  for (const r of rows) { if (r.rule) out[r.code] = r.rule; else if (DEFAULT_RULES[r.code]) out[r.code] = DEFAULT_RULES[r.code]; else delete out[r.code]; }
  return out;
}

/** Dates on which rules were saved, newest first, with the codes changed. */
export async function ruleHistory(q: Q) {
  return (await q.query<{ on: string; codes: string[]; by: string | null }>(
    `SELECT v.saved_at::date::text "on", array_agg(DISTINCT v.code ORDER BY v.code) codes, string_agg(DISTINCT u.name, ', ') by
       FROM audit_rule_version v LEFT JOIN app_user u ON u.id=v.saved_by GROUP BY v.saved_at::date ORDER BY v.saved_at::date DESC`)).rows;
}

// ---------- drafts ----------
export async function getDraft(q: Q, userId: string): Promise<RuleTable | null> {
  return (await q.query<{ rules: RuleTable }>(`SELECT rules FROM audit_rule_draft WHERE user_id=$1`, [userId])).rows[0]?.rules ?? null;
}
export async function saveDraft(q: Q, userId: string, rules: RuleTable): Promise<void> {
  const clean = Object.fromEntries(Object.entries(rules).map(([c, r]) => [c, checkRule(c, r)]));
  await q.query(`INSERT INTO audit_rule_draft (user_id, rules) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET rules=EXCLUDED.rules, created_at=now()`, [userId, JSON.stringify(clean)]);
}
export async function discardDraft(q: Q, userId: string): Promise<void> {
  await q.query(`DELETE FROM audit_rule_draft WHERE user_id=$1`, [userId]);
}

// ---------- testing a draft ----------
export interface RuleChange {
  propertyId: string; property: string; batchId: string; auditedOn: string;
  building: string; unit: string; service: string; code: string;
  before: Recommendation; after: Recommendation;
  /** What the reviewer decided for this unit, when they changed the recommendation. */
  reviewer: string | null;
}
export interface RuleTest {
  audits: number; units: number; changed: RuleChange[];
  /** Units a reviewer decided: how many the rules got right now, and with the draft. */
  reviewed: number; agreeBefore: number; agreeAfter: number;
  /** Codes whose rule the draft changes. */
  codes: string[];
}

const key = (r: Recommendation) => `${r.action}|${r.owner ?? ''}|${r.component ?? ''}`;

/** Run the latest audit of each property (up to `limit`, newest first) with the rules in force and with the draft. */
export async function testRules(db: Db, draft: RuleTable, o: { limit?: number; asOf: string }): Promise<RuleTest> {
  const { auditLines } = await import('../queries/audit');
  const current = await loadRules(db);
  const codes = [...new Set([...Object.keys(current), ...Object.keys(draft)])].filter((c) => !sameRule(current[c], draft[c])).sort();
  const batches = (await db.query<{ id: string; pid: string; name: string; on: string }>(
    `SELECT DISTINCT ON (b.property_id) b.id, p.id pid, p.name, b.imported_at::date::text "on"
       FROM import_batch b JOIN property p ON p.id=b.property_id WHERE b.kind IN ('auto_audit','manual_audit')
      ORDER BY b.property_id, b.imported_at DESC`)).rows.sort((a, b) => b.on.localeCompare(a.on)).slice(0, o.limit ?? 50);
  const out: RuleTest = { audits: batches.length, units: 0, changed: [], reviewed: 0, agreeBefore: 0, agreeAfter: 0, codes };
  for (const b of batches) {
    const before = await auditLines(db, b.id, o.asOf);
    const after = codes.length ? await auditLines(db, b.id, o.asOf, { rules: draft }) : before;
    out.units += before.length;
    before.forEach((l, i) => {
      const a = after[i];
      const reviewer = l.override ? l.recommendation.action : null;
      if (l.override) {
        out.reviewed++;
        if (key(l.rules) === key(l.recommendation)) out.agreeBefore++;
        if (key(a.rules) === key(l.recommendation)) out.agreeAfter++;
      }
      if (key(l.rules) !== key(a.rules)) out.changed.push({ propertyId: b.pid, property: b.name, batchId: b.id, auditedOn: b.on, building: l.building, unit: l.unit, service: l.service, code: l.code, before: l.rules, after: a.rules, reviewer });
    });
  }
  return out;
}

// ---------- saving ----------
/** Save the person's tested draft as the rules in force. Rows equal to the built-in rule are removed (built-in again). */
export async function saveRules(db: Db, userId: string, summary: Pick<RuleTest, 'audits' | 'changed' | 'reviewed' | 'agreeBefore' | 'agreeAfter'>): Promise<string[]> {
  return db.transaction(async (tx) => {
    const draft = await getDraft(tx, userId);
    if (!draft) throw new RuleError('There is no tested draft to save.');
    const current = await loadRules(tx);
    const changed = [...new Set([...Object.keys(current), ...Object.keys(draft)])].filter((c) => !sameRule(current[c], draft[c])).sort();
    for (const c of changed) {
      const r = draft[c];
      // Every version is kept, so the rules in force on any date can be shown.
      await tx.query(`INSERT INTO audit_rule_version (code, rule, saved_by) VALUES ($1,$2,$3)`, [c, r && !sameRule(DEFAULT_RULES[c], r) ? JSON.stringify(checkRule(c, r)) : null, userId]);
      if (!r) {
        if (DEFAULT_RULES[c]) throw new RuleError(`${c} is a built-in code and keeps a rule; set it to "Review manually" instead.`);
        await tx.query(`DELETE FROM audit_rule WHERE code=$1`, [c]);
      } else if (sameRule(DEFAULT_RULES[c], r)) await tx.query(`DELETE FROM audit_rule WHERE code=$1`, [c]);
      else await tx.query(`INSERT INTO audit_rule (code, rule, updated_by) VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE SET rule=EXCLUDED.rule, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [c, JSON.stringify(checkRule(c, r)), userId]);
    }
    if (changed.length) await tx.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'rules_changed','audit_rule',$2,$3)`,
      [userId, changed.join(','), JSON.stringify({ from: Object.fromEntries(changed.map((c) => [c, current[c] ?? null])), to: Object.fromEntries(changed.map((c) => [c, draft[c] ?? null])),
        tested: { audits: summary.audits, unitsChanged: summary.changed.length, reviewed: summary.reviewed, agreeBefore: summary.agreeBefore, agreeAfter: summary.agreeAfter } })]);
    await discardDraft(tx, userId);
    return changed;
  });
}
