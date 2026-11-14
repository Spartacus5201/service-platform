// Adding and editing a property's details. Every change is in the activity log with what changed.
import type { Db, Q } from '../db';
import { UserError } from '../errors';

export class PropertyError extends UserError {}

export interface PropertyFields {
  name: string | null; address: string | null; billingCode: string | null; installedByUs: boolean; installCompletedOn: string | null;
  salesforceAccountRef: string | null; accessNotes: string | null; schedulingNotes: string | null; billingContract: boolean;
  city: string | null; state: string | null; zip: string | null;
}
const COLS: [keyof PropertyFields, string][] = [['name', 'name'], ['address', 'address'], ['billingCode', 'billing_code'], ['installedByUs', 'installed_by_us'],
  ['installCompletedOn', 'install_completed_on'], ['salesforceAccountRef', 'salesforce_account_ref'], ['accessNotes', 'access_notes'],
  ['schedulingNotes', 'scheduling_notes'], ['billingContract', 'billing_contract'], ['city', 'city'], ['state', 'state'], ['zip', 'zip']];

export async function createProperty(q: Q, userId: string | null, p: { classId: string | null; name: string | null; address: string | null; installedByUs: boolean }): Promise<string> {
  if (!p.classId || !p.name) throw new PropertyError('ClassID and name are required.');
  if ((await q.query(`SELECT 1 FROM property WHERE class_id=$1`, [p.classId])).rows.length) throw new PropertyError(`ClassID ${p.classId} already exists.`);
  const id = (await q.query<{ id: string }>(`INSERT INTO property (class_id,name,address,installed_by_us) VALUES ($1,$2,$3,$4) RETURNING id`, [p.classId, p.name, p.address, p.installedByUs])).rows[0].id;
  await q.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'property_added','property',$2,$3)`, [userId, id, JSON.stringify({ classId: p.classId, name: p.name })]);
  return id;
}

export async function updateProperty(q: Q, userId: string | null, id: string, f: PropertyFields): Promise<void> {
  if (!f.name) throw new PropertyError('The property needs a name.');
  if (f.installCompletedOn && !/^\d{4}-\d{2}-\d{2}$/.test(f.installCompletedOn)) throw new PropertyError('Enter the install completion date as a date.');
  const before = (await q.query<Record<string, unknown>>(`SELECT ${COLS.map(([, c]) => `${c}${c === 'install_completed_on' ? '::text' : ''} AS ${c}`).join(', ')} FROM property WHERE id=$1`, [id])).rows[0];
  if (!before) throw new PropertyError('Unknown property.');
  await q.query(`UPDATE property SET ${COLS.map(([, c], i) => `${c}=$${i + 2}`).join(', ')} WHERE id=$1`, [id, ...COLS.map(([k]) => f[k])]);
  const changed = Object.fromEntries(COLS.filter(([k, c]) => (before[c] ?? null) !== (f[k] ?? null)).map(([k, c]) => [k, { from: before[c] ?? null, to: f[k] ?? null }]));
  if (Object.keys(changed).length)
    await q.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'property_changed','property',$2,$3)`, [userId, id, JSON.stringify(changed)]);
}
