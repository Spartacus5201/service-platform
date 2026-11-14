// What a later audit says about a unit that was serviced: one answer, used by the audit page (unit stages),
// verification (Today's "still failing", the visit checklist) and the After Action Report.
// It comes from the rules engine with any reviewer change applied, so a reviewer's "No action" counts everywhere.
//   fixed    the audit needs no action on the unit
//   failing  the equipment is still not right (Needs Service, or Verify ID: the ID still does not match)
//   flagged  something else needs a look (usage to investigate, requested by the property, unrecognised code):
//            a new item for the property, not a failed repair
import type { Recommendation } from '../rules/audit';

export type AfterVerdict = 'fixed' | 'failing' | 'flagged';

export function afterService(rec: Pick<Recommendation, 'action'>): AfterVerdict {
  if (rec.action === 'No action') return 'fixed';
  if (rec.action === 'Needs Service' || rec.action === 'Verify ID') return 'failing';
  return 'flagged';
}
