// Editable lists: the short lists of codes and words the app offers in forms and prints on documents.
//
// Built-in items live here, in code, because the workflow relies on them (a "replace" action asks for parts, an NT
// code points at the transmitter). The database holds only what people changed: a new label or wording for a
// built-in item, its order, whether it is retired, and the items they added. Nothing is deleted, only retired, so old
// records still read correctly.
//
// Three kinds of list:
// - fixed:      rename, reword and reorder only. The workflow depends on every item.
// - works_like: items can be added; each new item says which built-in item it works like. Records keep the built-in
//               code (so every rule and report keeps working) and the item that was picked (so it is shown as picked).
// - free:       add, rename, reorder and retire freely. The stored value is the item's code.
import { UserError } from '../errors';
import type { Q } from '../db';

export class ListError extends UserError {}
export type ListKind = 'fixed' | 'works_like' | 'free';
export type ListKey = 'audit_code' | 'visit_action' | 'visit_result' | 'visit_outcome' | 'part_kind' | 'device_kind' | 'charge_code' | 'job_source'
  | 'milestone' | 'system_brand' | 'utility' | 'price_item';

export interface ListItem {
  list: ListKey; code: string; label: string; wording: string | null; worksLike: string | null;
  builtin: boolean; active: boolean; sort: number;
}
interface Builtin { code: string; label: string; wording?: string }
export interface ListDef {
  key: ListKey; name: string; hint: string; kind: ListKind;
  /** What the wording column is for; no wording column when absent. */
  wording?: string;
  /** How a new item's code is written: as typed in capitals (audit codes), made from the label, or the label itself. */
  code: 'upper' | 'snake' | 'text';
  /** Built-in items a new item may work like (default: all). */
  worksLikeOf?: string[];
  /** Built-in items may be retired (hidden from forms). */
  retireBuiltins: boolean;
  builtins: Builtin[];
}

export const LIST_DEFS: ListDef[] = [
  { key: 'audit_code', name: 'Audit codes', kind: 'works_like', code: 'upper', retireBuiltins: false,
    hint: 'Codes in audit reports. A new code (as the report writes it) works like a built-in code, so the audit rules treat it the same way.',
    wording: 'Opening sentence of the client comment',
    worksLikeOf: ['OK', 'NI', 'NT', 'INT', 'IDMM', 'HIGH', 'LOW', 'NEG'],
    builtins: [
      { code: 'OK', label: 'Reading OK' },
      { code: 'NI', label: 'No usage recorded', wording: 'The meter was not recording any usage.' },
      { code: 'NT', label: 'Not transmitting', wording: 'The transmitter was not sending readings.' },
      { code: 'INT', label: 'Intermittent transmission', wording: 'Readings from this unit were arriving only occasionally.' },
      { code: 'IDMM', label: 'Device ID mismatch', wording: 'The device ID on file did not match the device installed.' },
      { code: 'HIGH', label: 'High usage', wording: 'Usage on this unit was higher than expected.' },
      { code: 'LOW', label: 'Low usage', wording: 'Usage on this unit was lower than expected.' },
      { code: 'NEG', label: 'Negative usage', wording: 'Usage on this unit was reported as negative.' },
      { code: 'OTHER', label: 'Other' },
    ] },
  { key: 'visit_action', name: 'Visit actions', kind: 'works_like', code: 'snake', retireBuiltins: true,
    hint: 'What the technician did at a unit. A new action works like a built-in one. Replacing parts always uses the built-in Replace, which asks for the parts.',
    worksLikeOf: ['inspect_test', 'repair', 'reprogram', 'other'],
    builtins: [
      { code: 'inspect_test', label: 'Inspect / test' }, { code: 'repair', label: 'Repair' }, { code: 'replace', label: 'Replace' },
      { code: 'reprogram', label: 'Reprogram' }, { code: 'other', label: 'Other' },
    ] },
  { key: 'visit_result', name: 'Visit results', kind: 'works_like', code: 'snake', retireBuiltins: true,
    hint: 'How the work at a unit ended. A new result works like a built-in one for warranty, follow-up and reports.',
    wording: 'Sentence in the client comment ({part} = the parts replaced, {tx} = the new transmitter ID)',
    worksLikeOf: ['repaired', 'replaced', 'reprogrammed', 'no_fault_found', 'unable_to_access', 'unable_to_complete', 'other'],
    builtins: [
      { code: 'repaired', label: 'Repaired', wording: 'We repaired the {part} on site. The unit should report normally on the next read cycle.' },
      { code: 'replaced', label: 'Replaced', wording: 'We replaced the {part}{tx}. The unit should report normally on the next read cycle.' },
      { code: 'reprogrammed', label: 'Reprogrammed', wording: 'We reprogrammed the device and confirmed the setup. The unit should report normally on the next read cycle.' },
      { code: 'no_fault_found', label: 'No fault found', wording: 'We inspected and tested the equipment and found no fault.' },
      { code: 'unable_to_access', label: 'Unable to access', wording: 'We could not get access to the unit. It will need to be rescheduled.' },
      { code: 'unable_to_complete', label: 'Unable to complete', wording: 'We could not complete the work on this visit. A follow-up visit will be scheduled.' },
      { code: 'other', label: 'Other', wording: '' },
    ] },
  { key: 'visit_outcome', name: 'Visit outcomes', kind: 'fixed', code: 'snake', retireBuiltins: false,
    hint: 'How the visit as a whole went. Warranty and revisits depend on these, so items cannot be added.',
    builtins: [{ code: 'completed', label: 'Completed' }, { code: 'unable_to_access', label: 'Unable to access' }, { code: 'unable_to_complete', label: 'Unable to complete' }] },
  { key: 'part_kind', name: 'Replaced part kinds', kind: 'fixed', code: 'snake', retireBuiltins: false,
    hint: 'The kinds of part a replacement can be. Warranty depends on these.', wording: 'Word used in the client comment',
    builtins: [{ code: 'transmitter', label: 'Transmitter', wording: 'transmitter' }, { code: 'meter', label: 'Meter', wording: 'meter' }, { code: 'combo', label: 'Meter and transmitter', wording: 'meter and transmitter' }] },
  { key: 'device_kind', name: 'Equipment kinds', kind: 'fixed', code: 'snake', retireBuiltins: false,
    hint: 'The kinds of equipment in the registry.',
    builtins: [{ code: 'meter', label: 'Meter' }, { code: 'transmitter', label: 'Transmitter' }, { code: 'combo', label: 'Combo (meter and transmitter)' },
      { code: 'repeater', label: 'Repeater' }, { code: 'collector', label: 'Collector' }, { code: 'receiver', label: 'Receiver' }] },
  { key: 'charge_code', name: 'Charge codes', kind: 'fixed', code: 'text', retireBuiltins: false,
    hint: 'The billing system\'s charge codes. Invoicing depends on these, so items cannot be added here.',
    builtins: [{ code: '20', label: 'Billable' }, { code: '21', label: 'MSA (meter service agreement)' }, { code: '23', label: 'Installation Warranty' }] },
  { key: 'job_source', name: 'Job sources', kind: 'free', code: 'snake', retireBuiltins: true, hint: 'How a job came in.',
    builtins: [{ code: 'salesforce', label: 'Salesforce case' }, { code: 'phone', label: 'Phone' }, { code: 'email', label: 'Email' }, { code: 'audit', label: 'Audit' }, { code: 'other', label: 'Other' }] },
  { key: 'milestone', name: 'Property milestones', kind: 'free', code: 'text', retireBuiltins: true, hint: 'The milestone shown in a property\'s WA notes. (The install warranty uses the install completion date, not this list.)',
    builtins: [{ code: 'Install Complete', label: 'Install Complete' }, { code: 'Takeover', label: 'Takeover' }, { code: 'Upgraded', label: 'Upgraded' }] },
  { key: 'system_brand', name: 'Reading system brands', kind: 'free', code: 'text', retireBuiltins: true, hint: 'The reading system a property uses (WA notes).',
    builtins: ['Aclara', 'Byram', 'Inovonics', 'Itron', 'NextCentury', 'SpeedRead', 'Stealth', 'Tehama'].map((b) => ({ code: b, label: b })) },
  { key: 'utility', name: 'Utilities (WA notes)', kind: 'free', code: 'text', retireBuiltins: true, hint: 'The utilities listed in a property\'s WA notes.',
    builtins: ['Water', 'Cold', 'Hot', 'Electric', 'Gas', 'HVAC', 'Remote Reader', 'RTM', 'Transmitter'].map((b) => ({ code: b, label: b })) },
  { key: 'price_item', name: 'Property price items', kind: 'free', code: 'text', retireBuiltins: true, hint: 'The items a property can have its own price for (WA notes). Renaming changes the name shown; prices already entered stay with the item.',
    builtins: ['Labor', 'AMR Labor', 'Meter', 'Cold Meter', 'Hot Meter', 'EL Meter', 'GS Meter', 'HV Meter', 'Transmitter', 'ETR', 'Collector', 'Converter', 'Receiver', 'Remote Reader', 'Repeater', 'Reed Switch'].map((b) => ({ code: b, label: b })) },
];
export const LIST_KEYS = LIST_DEFS.map((d) => d.key);
export const listDef = (k: string) => LIST_DEFS.find((d) => d.key === k);

/** Every list's items: the built-ins as shipped, overlaid with what people changed and added. */
export class Lists {
  constructor(private readonly all: ListItem[]) {}
  /** Items in order; retired ones only when asked. */
  items(list: ListKey, o: { includeRetired?: boolean } = {}): ListItem[] {
    return this.all.filter((i) => i.list === list && (o.includeRetired || i.active)).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  }
  get(list: ListKey, code: string | null | undefined): ListItem | undefined {
    if (code == null) return undefined;
    const c = listDef(list)?.code === 'upper' ? code.trim().toUpperCase() : code;
    return this.all.find((i) => i.list === list && i.code === c);
  }
  /** What to show for a stored code: its label, or the code itself when it is not on the list. */
  label(list: ListKey, code: string | null | undefined): string { return this.get(list, code)?.label ?? code ?? ''; }
  wording(list: ListKey, code: string | null | undefined): string | null { return this.get(list, code)?.wording ?? null; }
  /** The built-in code an item works like (a built-in works like itself); null when not on the list or retired. */
  worksLike(list: ListKey, code: string | null | undefined): string | null {
    const i = this.get(list, code); if (!i || !i.active) return null;
    return i.builtin ? i.code : i.worksLike;
  }
  /** A form value checked against the active items: the built-in code to store and the custom item, if one was picked. */
  pick(list: ListKey, value: FormDataEntryValue | string | null | undefined): { code: string; item: string | null } | null {
    const v = typeof value === 'string' ? value.trim() : null; if (!v) return null;
    const i = this.get(list, v); if (!i || !i.active) return null;
    if (listDef(list)!.kind !== 'works_like' || i.builtin) return { code: i.code, item: null };
    return { code: i.worksLike!, item: i.code };
  }
  /** Active codes, for checking a free-list value. */
  codes(list: ListKey): string[] { return this.items(list).map((i) => i.code); }
}

const builtinItems = (): ListItem[] => LIST_DEFS.flatMap((d) => d.builtins.map((b, n) => ({
  list: d.key, code: b.code, label: b.label, wording: d.wording ? b.wording ?? null : null, worksLike: null, builtin: true, active: true, sort: n + 1,
})));
/** The lists as shipped; used where there is no database, and as the base the database overlays. */
export const BUILTIN_LISTS = new Lists(builtinItems());

interface Row { list: ListKey; code: string; label: string; wording: string | null; works_like: string | null; active: boolean; sort: number }
export async function loadLists(q: Q): Promise<Lists> {
  const rows = (await q.query<Row>(`SELECT list, code, label, wording, works_like, active, sort FROM list_item`)).rows;
  const items = builtinItems();
  for (const r of rows) {
    const b = items.find((i) => i.list === r.list && i.code === r.code);
    if (b) Object.assign(b, { label: r.label, wording: listDef(r.list)?.wording ? r.wording : null, active: r.active, sort: r.sort });
    else if (listDef(r.list)) items.push({ list: r.list, code: r.code, label: r.label, wording: r.wording, worksLike: r.works_like, builtin: false, active: r.active, sort: r.sort });
  }
  return new Lists(items);
}

export interface ItemInput { list: string; code?: string | null; /** For a new item in a list whose codes are typed (audit codes). */ newCode?: string | null; label: string; wording?: string | null; worksLike?: string | null; active: boolean; sort?: number | null }

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Add an item, or change one. Codes never change once made; built-in items keep their behaviour. */
export async function saveListItem(q: Q, userId: string | null, x: ItemInput): Promise<'added' | 'changed' | 'unchanged'> {
  const def = listDef(x.list); if (!def) throw new ListError('Unknown list.');
  const label = x.label.trim(); if (!label) throw new ListError('Give the item a name.');
  if (label.length > 120) throw new ListError('Keep the name under 120 characters.');
  const lists = await loadLists(q);
  const all = lists.items(def.key, { includeRetired: true });
  const isNew = !x.code;
  const code = isNew ? (def.code === 'upper' ? (x.newCode ?? '').trim().toUpperCase() : def.code === 'snake' ? slug(label) : label) : x.code!;
  const cur = all.find((i) => i.code === code);
  if (isNew) {
    if (def.kind === 'fixed') throw new ListError(`${def.name} cannot have items added: the workflow depends on each one.`);
    if (!code || (def.code === 'upper' && !/^[A-Z0-9]{1,12}$/.test(code))) throw new ListError('A code is 1 to 12 letters or digits, as the report writes it.');
    if (cur) throw new ListError(`"${code}" is already on the list${cur.active ? '' : ' (retired; tick Active to bring it back)'}.`);
    if (all.some((i) => i.label.toLowerCase() === label.toLowerCase())) throw new ListError(`"${label}" is already on the list.`);
  } else if (!cur) throw new ListError('That item is not on the list.');
  let worksLike: string | null = null;
  if (def.kind === 'works_like' && !(cur?.builtin)) {
    worksLike = x.worksLike?.trim() || cur?.worksLike || null;
    const allowed = def.worksLikeOf ?? def.builtins.map((b) => b.code);
    if (!worksLike || !allowed.includes(worksLike)) throw new ListError(`Say which built-in item "${label}" works like.`);
  }
  if (cur?.builtin && !x.active && !def.retireBuiltins) throw new ListError(`Built-in ${def.name.toLowerCase()} cannot be retired.`);
  if (!x.active && lists.items(def.key).filter((i) => i.code !== code).length === 0) throw new ListError('A list needs at least one active item.');
  const wording = def.wording ? (x.wording ?? '').trim() || null : null;
  const sort = x.sort ?? cur?.sort ?? Math.max(0, ...all.map((i) => i.sort)) + 1;
  const next = { label, wording, worksLike, active: x.active, sort };
  if (cur && cur.label === label && (cur.wording ?? null) === wording && (cur.worksLike ?? null) === worksLike && cur.active === x.active && cur.sort === sort) return 'unchanged';
  await q.query(`INSERT INTO list_item (list,code,label,wording,works_like,active,sort,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (list,code) DO UPDATE SET label=EXCLUDED.label, wording=EXCLUDED.wording, works_like=EXCLUDED.works_like,
                   active=EXCLUDED.active, sort=EXCLUDED.sort, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [def.key, code, label, wording, worksLike, x.active, sort, userId]);
  const from = cur ? { label: cur.label, wording: cur.wording, worksLike: cur.worksLike, active: cur.active, sort: cur.sort } : null;
  await q.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,$2,'list_item',$3,$4)`,
    [userId, cur ? 'list_item_changed' : 'list_item_added', `${def.key}:${code}`, JSON.stringify({ from, to: next })]);
  return cur ? 'changed' : 'added';
}

/** Put a built-in item back as shipped (label, wording, order, active). */
export async function restoreListItem(q: Q, userId: string | null, list: string, code: string): Promise<void> {
  const def = listDef(list); const b = def?.builtins.find((x) => x.code === code);
  if (!def || !b) throw new ListError('Only built-in items can be restored.');
  await q.query(`DELETE FROM list_item WHERE list=$1 AND code=$2`, [list, code]);
  await q.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'list_item_restored','list_item',$2,'{}')`, [userId, `${list}:${code}`]);
}

/** [code, label] pairs for a form select; `keep` adds a retired value a record already holds so it is not lost. */
export function choices(lists: Lists, list: ListKey, o: { keep?: string | null; except?: string[] } = {}): [string, string][] {
  const out: [string, string][] = lists.items(list).filter((i) => !o.except?.includes(i.code)).map((i) => [i.code, i.label]);
  if (o.keep && !out.some(([c]) => c === o.keep)) out.push([o.keep, `${lists.label(list, o.keep)} (retired)`]);
  return out;
}
