// Setup export and import: everything people configure (settings, lists, service codes, equipment, audit rules,
// import maps, catalog and prices, standard clauses, roles), as one file. Not data: no properties, audits, visits,
// documents or users. Moving to the company server, or putting a setup back, is: export here, import there.
//
// Importing is previewed first (added, changed, unchanged, only on this server) and runs in one transaction. Before
// it runs, the current setup is kept as a snapshot, so an import can be undone. Nothing is deleted except where the
// file is the whole truth for a table (audit rules: a missing row means the built-in rule; a role's permission grid).
import { UserError } from '../errors';
import type { Db, Q } from '../db';
import { SETTING_DEFAULTS } from '../settings';
import { PERMISSIONS } from '../auth/permissions';

export class SetupError extends UserError {}
export const SETUP_FORMAT = 1;

type Row = Record<string, unknown>;
interface Section {
  key: string; label: string; table: string;
  /** Columns that identify a row (kept the same across servers). */
  keys: string[];
  /** Columns never exported: who and when, and anything that only means something on this server. */
  skip?: string[];
  /** Rows to include (SQL condition). */
  where?: string;
  /** merge: add and update, keep rows only on this server. match: make the table (or each group) equal to the file. */
  mode: 'merge' | 'match';
  /** For match by group: only groups present in the file are replaced. */
  group?: string;
  /** Columns written in a second pass (rows that point at other rows of the same table). */
  late?: string[];
  /** The ON CONFLICT target when the key is matched through an expression index. */
  conflict?: string;
  /** Columns that point at another row by its id: written to the file as that row's key, so ids need not match between servers. */
  refs?: Record<string, { table: string; by: string[] }>;
}

/** In the order they are imported: catalog before equipment (equipment points at catalog parts), roles before permissions. */
export const SECTIONS: Section[] = [
  { key: 'settings', label: 'Settings', table: 'setting', keys: ['key'], where: `key = ANY('{${Object.keys(SETTING_DEFAULTS).join(',')}}')`, mode: 'merge' },
  { key: 'lists', label: 'Lists', table: 'list_item', keys: ['list', 'code'], skip: ['updated_by', 'updated_at'], mode: 'merge' },
  { key: 'services', label: 'Service codes', table: 'service_type', keys: ['code'], skip: ['created_at'], mode: 'merge' },
  { key: 'catalog', label: 'Catalog and prices', table: 'catalog_item', keys: ['id'], mode: 'merge' },
  // Equipment models are matched by manufacturer and model (the starter models have different ids on each server).
  { key: 'equipment', label: 'Equipment registry', table: 'equipment_model', keys: ['manufacturer', 'model'], skip: ['id', 'created_by', 'created_at', 'updated_at'], mode: 'merge',
    conflict: '(lower(manufacturer)), (lower(model))', late: ['replaced_by'], refs: { replaced_by: { table: 'equipment_model', by: ['manufacturer', 'model'] } } },
  { key: 'rules', label: 'Audit rules', table: 'audit_rule', keys: ['code'], skip: ['updated_by', 'updated_at'], mode: 'match' },
  { key: 'layouts', label: 'Import maps', table: 'import_layout', keys: ['id', 'version'], skip: ['created_by', 'created_at'], mode: 'merge' },
  { key: 'clauses', label: 'Standard clauses', table: 'clause_template', keys: ['key', 'version'], skip: ['id'], mode: 'merge' },
  { key: 'roles', label: 'Roles', table: 'role', keys: ['key'], skip: ['created_at'], mode: 'merge' },
  { key: 'permissions', label: 'Role permissions', table: 'role_permission', keys: ['role_key', 'permission'], mode: 'match', group: 'role_key' },
];

export interface SetupFile {
  format: number; app: 'service-platform'; exportedAt: string; migration: string;
  sections: Record<string, Row[]>;
}

const ident = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`); return `"${s}"`; };

/** The table's columns as the database has them now (so a new column is exported without a code change), with which hold JSON. */
async function columnInfo(q: Q, sec: Section): Promise<{ cols: string[]; json: Set<string> }> {
  const rows = (await q.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name=$1 ORDER BY ordinal_position`, [sec.table])).rows
    .filter((r) => !(sec.skip ?? []).includes(r.column_name));
  return { cols: rows.map((r) => r.column_name), json: new Set(rows.filter((r) => r.data_type === 'json' || r.data_type === 'jsonb').map((r) => r.column_name)) };
}
const columns = async (q: Q, sec: Section) => (await columnInfo(q, sec)).cols;

/** Values compared by content: dates and numbers as text, JSON with sorted keys. */
function canon(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (typeof v === 'object') return `{${Object.keys(v as Row).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Row)[k])}`).join(',')}}`;
  return JSON.stringify(String(v));
}
const rowKey = (sec: Section, r: Row) => sec.keys.map((k) => canon(sec.conflict ? String(r[k] ?? '').toLowerCase() : r[k])).join('|');

async function readSection(q: Q, sec: Section): Promise<Row[]> {
  const cols = await columns(q, sec);
  const sel = cols.map((c) => {
    const ref = sec.refs?.[c];
    // A reference is written as the other row's key: {"manufacturer": "...", "model": "..."}.
    return ref ? `(SELECT json_build_object(${ref.by.map((b) => `'${b}', x.${ident(b)}`).join(', ')}) FROM ${ident(ref.table)} x WHERE x.id = t.${ident(c)}) AS ${ident(c)}` : `t.${ident(c)}`;
  }).join(', ');
  const rows = (await q.query<Row>(`SELECT ${sel} FROM ${ident(sec.table)} t ${sec.where ? `WHERE ${sec.where}` : ''} ORDER BY ${sec.keys.map((k) => `t.${ident(k)}`).join(', ')}`)).rows;
  const out = rows.map((r) => Object.fromEntries(cols.map((c) => [c, normal(r[c])])));
  // A setting never changed is not stored; write its default, so the file says every value.
  if (sec.key === 'settings') for (const [k, v] of Object.entries(SETTING_DEFAULTS)) if (!out.some((r) => r.key === k)) out.push({ key: k, value: v });
  return out.sort((a, b) => (sec.key === 'settings' ? String(a.key).localeCompare(String(b.key)) : 0));
}
/** Plain JSON values: timestamps as ISO text, the rest as the database gives them. */
function normal(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v;
}

export async function exportSetup(q: Q, now = new Date()): Promise<SetupFile> {
  const migration = (await q.query<{ name: string }>(`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`).catch(() => ({ rows: [] as { name: string }[] }))).rows[0]?.name ?? '';
  const sections: Record<string, Row[]> = {};
  for (const sec of SECTIONS) sections[sec.key] = await readSection(q, sec);
  return { format: SETUP_FORMAT, app: 'service-platform', exportedAt: now.toISOString(), migration, sections };
}

export interface SectionPreview {
  key: string; label: string; mode: Section['mode'];
  added: string[]; changed: string[]; unchanged: number;
  /** Rows only on this server: kept (merge) or removed (match). */
  onlyHere: string[];
}
export interface SetupPreview { exportedAt: string; migration: string; sections: SectionPreview[]; total: number; warnings: string[] }

const label = (sec: Section, r: Row) => {
  const pick = ['name', 'label', 'title', 'model', 'key', 'code'].find((c) => r[c] != null && !sec.keys.includes(c) && c !== 'key') ;
  const id = sec.keys.filter((k) => k !== 'id').map((k) => String(r[k])).join(' ');
  return [id, pick ? String(r[pick]) : ''].filter(Boolean).join(' · ') || String(r[sec.keys[0]]);
};

/** Read and check a setup file. */
export function parseSetup(text: string): SetupFile {
  let f: SetupFile;
  try { f = JSON.parse(text); } catch { throw new SetupError('That file is not a setup file (it is not JSON).'); }
  if (!f || f.app !== 'service-platform' || typeof f.sections !== 'object') throw new SetupError('That file is not a Service Platform setup file.');
  if (f.format !== SETUP_FORMAT) throw new SetupError(`This setup file is format ${f.format}; this version reads format ${SETUP_FORMAT}.`);
  for (const [k, rows] of Object.entries(f.sections)) {
    if (!SECTIONS.some((s) => s.key === k)) throw new SetupError(`Unknown section "${k}" in the setup file.`);
    if (!Array.isArray(rows)) throw new SetupError(`Section "${k}" is not a list.`);
  }
  return f;
}

/** What importing the file would do, section by section. Nothing is written. */
export async function previewSetup(q: Q, f: SetupFile): Promise<SetupPreview> {
  const out: SetupPreview = { exportedAt: f.exportedAt, migration: f.migration, sections: [], total: 0, warnings: [] };
  const here = (await q.query<{ name: string }>(`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`).catch(() => ({ rows: [] as { name: string }[] }))).rows[0]?.name ?? '';
  if (f.migration && here && f.migration > here) out.warnings.push(`The file comes from a newer version of the app (${f.migration}); update this server first.`);
  for (const sec of SECTIONS) {
    const rows = f.sections[sec.key]; if (!rows) continue;
    const cols = await columns(q, sec);
    const cur = new Map((await readSection(q, sec)).map((r) => [rowKey(sec, r), r]));
    const p: SectionPreview = { key: sec.key, label: sec.label, mode: sec.mode, added: [], changed: [], unchanged: 0, onlyHere: [] };
    const seen = new Set<string>();
    for (const r of rows) {
      for (const k of sec.keys) if (r[k] == null) throw new SetupError(`${sec.label}: a row is missing "${k}".`);
      const k = rowKey(sec, r); seen.add(k);
      const c = cur.get(k);
      if (!c) p.added.push(label(sec, r));
      else if (cols.some((col) => col in r && canon(r[col]) !== canon(c[col]))) p.changed.push(label(sec, r));
      else p.unchanged++;
    }
    const groups = sec.group ? new Set(rows.map((r) => canon(r[sec.group!]))) : null;
    for (const [k, c] of cur) if (!seen.has(k) && (!groups || groups.has(canon(c[sec.group!])))) p.onlyHere.push(label(sec, c));
    out.total += p.added.length + p.changed.length + (sec.mode === 'match' ? p.onlyHere.length : 0);
    out.sections.push(p);
  }
  return out;
}

/** Import the file: snapshot the current setup, then add and update (and remove where the file is the whole truth). */
export async function importSetup(db: Db, userId: string | null, f: SetupFile, reason = 'Before a setup import'): Promise<SetupPreview> {
  const preview = await previewSetup(db, f);
  await db.transaction(async (tx) => {
    await tx.query(`INSERT INTO setup_snapshot (taken_by, reason, content) VALUES ($1,$2,$3)`, [userId, reason, JSON.stringify(await exportSetup(tx))]);
    for (const sec of SECTIONS) {
      const rows = f.sections[sec.key]; if (!rows) continue;
      const info = await columnInfo(tx, sec);
      const cols = info.cols.filter((c) => rows.some((r) => c in r));
      const val = (c: string, v: unknown) => (v === undefined || v === null ? null : info.json.has(c) ? JSON.stringify(v) : v);
      const early = cols.filter((c) => !(sec.late ?? []).includes(c));
      const write = async (cs: string[], r: Row) => {
        const set = cs.filter((c) => !sec.keys.includes(c));
        await tx.query(
          `INSERT INTO ${ident(sec.table)} (${cs.map(ident).join(',')}) VALUES (${cs.map((_, i) => `$${i + 1}`).join(',')})
           ON CONFLICT (${sec.conflict ?? sec.keys.map(ident).join(',')}) ${set.length ? `DO UPDATE SET ${set.map((c) => `${ident(c)}=EXCLUDED.${ident(c)}`).join(', ')}` : 'DO NOTHING'}`,
          cs.map((c) => val(c, r[c])));
      };
      for (const r of rows) await write(early, r);
      const match = (alias: string, keys: string[], from: number) => keys.map((k, i) => sec.conflict ? `lower(${alias}.${ident(k)})=lower($${from + i})` : `${alias}.${ident(k)}=$${from + i}`).join(' AND ');
      if (sec.late?.length) for (const r of rows) {
        const late = sec.late.filter((c) => c in r);
        if (!late.length) continue;
        const sets: string[] = []; const args: unknown[] = [];
        for (const c of late) {
          const ref = sec.refs?.[c]; const v = r[c] as Row | null;
          if (ref && v) { sets.push(`${ident(c)}=(SELECT x.id FROM ${ident(ref.table)} x WHERE ${ref.by.map((b) => `lower(x.${ident(b)})=lower($${args.length + 1 + ref.by.indexOf(b)})`).join(' AND ')})`); args.push(...ref.by.map((b) => v[b])); }
          else { sets.push(`${ident(c)}=$${args.length + 1}`); args.push(val(c, v)); }
        }
        await tx.query(`UPDATE ${ident(sec.table)} t SET ${sets.join(', ')} WHERE ${match('t', sec.keys, args.length + 1)}`, [...args, ...sec.keys.map((k) => r[k])]);
      }
      if (sec.mode === 'match') {
        const keep = new Set(rows.map((r) => rowKey(sec, r)));
        const groups = sec.group ? new Set(rows.map((r) => canon(r[sec.group!]))) : null;
        for (const c of await readSection(tx, sec)) if (!keep.has(rowKey(sec, c)) && (!groups || groups.has(canon(c[sec.group!]))))
          await tx.query(`DELETE FROM ${ident(sec.table)} t WHERE ${match('t', sec.keys, 1)}`, sec.keys.map((k) => c[k]));
      }
    }
    // Guards that cannot be imported away: the Admin role keeps user and role management.
    for (const p of PERMISSIONS) if ('locked' in p && p.locked)
      await tx.query(`INSERT INTO role_permission (role_key, permission, scope) VALUES ('admin',$1,'all') ON CONFLICT (role_key, permission) DO UPDATE SET scope='all'`, [p.key]);
    // Rule versions: what the import changed becomes a dated version, like a save on the rules page.
    if (f.sections.rules) {
      const prev = preview.sections.find((s) => s.key === 'rules');
      for (const code of [...(prev?.added ?? []), ...(prev?.changed ?? []), ...(prev?.onlyHere ?? [])].map((x) => x.split(' · ')[0]))
        await tx.query(`INSERT INTO audit_rule_version (code, rule, saved_by) SELECT $1, (SELECT rule FROM audit_rule WHERE code=$1), $2`, [code, userId]);
    }
    await tx.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'setup_imported','setup',NULL,$2)`,
      [userId, JSON.stringify({ reason, exportedAt: f.exportedAt, sections: preview.sections.map((s) => ({ section: s.key, added: s.added.length, changed: s.changed.length, removed: s.mode === 'match' ? s.onlyHere.length : 0 })) })]);
  });
  return preview;
}

export async function listSnapshots(q: Q) {
  return (await q.query<{ id: string; taken_at: string; reason: string; by: string | null }>(
    `SELECT s.id, s.taken_at::text, s.reason, u.name by FROM setup_snapshot s LEFT JOIN app_user u ON u.id=s.taken_by ORDER BY s.taken_at DESC LIMIT 20`)).rows;
}
export async function getSnapshot(q: Q, id: string): Promise<SetupFile | null> {
  return (await q.query<{ content: SetupFile }>(`SELECT content FROM setup_snapshot WHERE id=$1`, [id])).rows[0]?.content ?? null;
}

// ---------- waiting to be imported (previewed first) ----------
export async function holdForImport(q: Q, userId: string, source: string, f: SetupFile): Promise<void> {
  await q.query(`INSERT INTO setup_import_draft (user_id, source, content) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET source=EXCLUDED.source, content=EXCLUDED.content, created_at=now()`,
    [userId, source, JSON.stringify(f)]);
}
export async function heldImport(q: Q, userId: string): Promise<{ source: string; file: SetupFile } | null> {
  const r = (await q.query<{ source: string; content: SetupFile }>(`SELECT source, content FROM setup_import_draft WHERE user_id=$1`, [userId])).rows[0];
  return r ? { source: r.source, file: r.content } : null;
}
export async function dropHeldImport(q: Q, userId: string): Promise<void> {
  await q.query(`DELETE FROM setup_import_draft WHERE user_id=$1`, [userId]);
}
