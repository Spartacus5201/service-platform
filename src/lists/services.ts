// Service codes (ServiceID): an editable list. The code is what the billing system uses and never changes once
// made; the name and the report words can. A report value is read as a service when it equals the code or one of
// its words, ignoring case and punctuation. Nothing is guessed from partial words.
import { UserError } from '../errors';
import type { Db, Q } from '../db';

export class ServiceListError extends UserError {}
export interface ServiceType { code: string; name: string; words: string[]; active: boolean; sort: number }

/** Same as the rows migration 022 creates; used where there is no database (the built-in parsers, tests). */
export const DEFAULT_SERVICES: ServiceType[] = [
  { code: 'WS', name: 'Water', words: ['water', 'all water', 'water-all', 'cold water', 'water-cold', 'domestic water', 'potable water'], active: true, sort: 1 },
  { code: 'GS', name: 'Gas', words: ['gas', 'natural gas'], active: true, sort: 2 },
  { code: 'EL', name: 'Electric', words: ['electric', 'electricity', 'elec'], active: true, sort: 3 },
  { code: 'HW', name: 'Hot Water', words: ['hot water', 'water-hot', 'domestic hot water'], active: true, sort: 4 },
  { code: 'CW', name: 'Chilled Water', words: ['chilled water'], active: true, sort: 5 },
  { code: 'HV', name: 'HVAC', words: ['hvac', 'heating', 'cooling', 'heating and cooling', 'btu'], active: true, sort: 6 },
  { code: 'WA', name: 'Water (alternate code)', words: [], active: true, sort: 7 },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The service code a report value means, or null when no code or word matches it exactly. */
export function matchService(value: string, list: ServiceType[] = DEFAULT_SERVICES): string | null {
  const v = norm(value); if (!v) return null;
  const byCode = list.find((s) => norm(s.code) === v); if (byCode) return byCode.code;
  return list.find((s) => s.words.some((w) => norm(w) === v) || norm(s.name) === v)?.code ?? null;
}

export async function listServices(q: Q, o: { includeRetired?: boolean } = {}): Promise<ServiceType[]> {
  return (await q.query<ServiceType>(`SELECT code, name, words, active, sort FROM service_type ${o.includeRetired ? '' : 'WHERE active'} ORDER BY sort, code`)).rows;
}

/** Add a service, or change the name, words, order or active flag of one. Codes cannot be renamed. */
export async function saveService(q: Q, userId: string | null, s: { code: string; name: string; words: string[]; active: boolean; sort?: number }): Promise<'added' | 'changed' | 'unchanged'> {
  const code = s.code.trim().toUpperCase(); const name = s.name.trim();
  if (!/^[A-Z0-9]{1,6}$/.test(code)) throw new ServiceListError('A service code is 1 to 6 letters or digits, e.g. HW.');
  if (!name) throw new ServiceListError('Give the service a name.');
  const words = [...new Set(s.words.map((w) => w.trim().toLowerCase()).filter(Boolean))];
  const all = await listServices(q, { includeRetired: true });
  for (const w of words) {
    const other = all.find((x) => x.code !== code && (norm(x.code) === norm(w) || x.words.some((y) => norm(y) === norm(w))));
    if (other) throw new ServiceListError(`"${w}" already means ${other.code} (${other.name}). One word can only mean one service.`);
  }
  const cur = all.find((x) => x.code === code);
  const sort = s.sort ?? cur?.sort ?? Math.max(0, ...all.map((x) => x.sort)) + 1;
  if (cur && cur.name === name && cur.active === s.active && cur.sort === sort && JSON.stringify(cur.words) === JSON.stringify(words)) return 'unchanged';
  await q.query(`INSERT INTO service_type (code,name,words,active,sort) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, words=EXCLUDED.words, active=EXCLUDED.active, sort=EXCLUDED.sort`, [code, name, words, s.active, sort]);
  await q.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,$2,'service_type',$3,$4)`,
    [userId, cur ? 'service_changed' : 'service_added', code, JSON.stringify(cur ? { from: { name: cur.name, words: cur.words, active: cur.active }, to: { name, words, active: s.active } } : { name, words })]);
  return cur ? 'changed' : 'added';
}
