// Reviewer corrections. The rules propose; a person disposes. Every change is logged, and the rules' own answer is kept beside it.
import type { Db } from '../db';
import type { Recommendation } from '../rules/audit';

export class ReviewError extends Error {}
export const ACTIONS: Recommendation['action'][] = ['No action', 'Needs Service', 'Verify ID', 'Investigate', 'Requested by property', 'Unrecognized'];
const OWNERS = ['property', 'service coordinator'];
const COMPONENTS = ['meter', 'transmitter', 'both', 'manual_pick'];

export interface OverrideInput { action: Recommendation['action']; owner?: string | null; component?: string | null; reason: string }

/** Set the final answer for one reading. Matching the rules exactly removes the override instead. */
export async function setOverride(db: Db, readingId: string, i: OverrideInput, userId: string | null, rules: Recommendation): Promise<'saved' | 'cleared'> {
  if (!ACTIONS.includes(i.action)) throw new ReviewError(`Unknown action "${i.action}".`);
  const reason = i.reason?.trim() ?? '';
  if (reason.length < 3) throw new ReviewError('Give a short reason for the change.');
  const owner = i.action === 'Investigate' ? (i.owner || rules.owner || 'property') : null;
  const component = i.action === 'Needs Service' ? (i.component || rules.component || 'manual_pick') : i.action === 'Verify ID' ? (i.component || rules.component || 'transmitter') : null;
  if (owner && !OWNERS.includes(owner)) throw new ReviewError(`Unknown owner "${owner}".`);
  if (component && !COMPONENTS.includes(component)) throw new ReviewError(`Unknown component "${component}".`);
  const same = i.action === rules.action && (owner ?? undefined) === rules.owner && (component ?? undefined) === (rules.component ?? undefined);
  if (same) { await clearOverride(db, readingId, userId); return 'cleared'; }
  await db.query(
    `INSERT INTO audit_override (reading_id,action,owner,component,reason,rules_action,user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (reading_id) DO UPDATE SET action=EXCLUDED.action, owner=EXCLUDED.owner, component=EXCLUDED.component, reason=EXCLUDED.reason, rules_action=EXCLUDED.rules_action, user_id=EXCLUDED.user_id, created_at=now()`,
    [readingId, i.action, owner, component, reason, rules.action, userId]);
  await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'audit_override','audit_reading',$2,$3)`,
    [userId, readingId, JSON.stringify({ to: i.action, owner, component, reason, rules: rules.action })]);
  return 'saved';
}

export async function clearOverride(db: Db, readingId: string, userId: string | null): Promise<void> {
  const r = await db.query(`DELETE FROM audit_override WHERE reading_id=$1`, [readingId]);
  if (r.affectedRows) await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'audit_override_cleared','audit_reading',$2,'{}')`, [userId, readingId]);
}
