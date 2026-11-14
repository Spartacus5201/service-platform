// The import wizard's server side: files waiting to be mapped, saved maps (versioned), and the final import.
// The wizard never imports what the preview did not show: commit re-runs the same preview, checks the map it
// is about to save reads this file the same way, then hands the result to the normal commit step.
import type { Db } from '../db';
import { readWorkbook, parseCsv, type Sheet, type Cell } from '../parsers/common';
import { importParsed, type ImportResult } from '../import/commit';
import { BUILTIN } from './builtin';
import { matchLayouts, preview, type Preview } from './index';
import { normHeader, type ColumnRule, type Layout, type Overrides, type Target } from './layout';
import { TARGETS } from './targets';
import { listServices } from '../lists/services';
import type { ConvertContext } from './convert';

const ctxOf = async (q: Q): Promise<ConvertContext> => ({ services: await listServices(q, { includeRetired: true }) });

type Q = Pick<Db, 'query'>;
export class WizardError extends Error {}

export interface WizardState {
  target?: Target;
  layoutId?: string; layoutVersion?: number;
  overrides: Overrides;
  /** Why the excluded rows are left out (required when any are). */
  excludeReason?: string;
  /** Columns were filled in from header names and have not been confirmed yet. */
  suggested?: boolean;
}

const text = (c: Cell | undefined) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).trim();
const hasKeys = (o?: object) => !!o && Object.keys(o).length > 0;

export async function readSheets(bytes: Uint8Array): Promise<Sheet[]> {
  if (bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b) return readWorkbook(Buffer.from(bytes));
  const t = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const rows = first.includes('\t') && !first.includes(',') ? t.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t')) : parseCsv(t);
  return [{ name: 'CSV', rows }];
}

/** First row in the top 15 with at least three filled cells, most of them words rather than numbers. 1-based. */
export function guessHeaderRow(rows: Cell[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] ?? []).map(text).filter(Boolean);
    if (cells.length >= 3 && cells.filter((c) => !/^[\d.,$%/-]+$/.test(c)).length >= cells.length * 0.7) return i + 1;
  }
  return 1;
}

// ---------- saved maps ----------
export interface SavedLayout extends Layout { builtin: boolean; retired: boolean; createdAt: string | null; uses: number }

export async function listLayouts(q: Q, o: { includeRetired?: boolean } = {}): Promise<SavedLayout[]> {
  const rows = (await q.query<{ definition: Layout; retired_at: string | null; created_at: string; uses: string }>(
    `SELECT DISTINCT ON (l.id) l.definition, l.retired_at::text, l.created_at::text,
            (SELECT count(*) FROM import_batch b WHERE b.layout_id=l.id) uses
       FROM import_layout l ORDER BY l.id, l.version DESC`)).rows;
  const saved = rows.map((r) => ({ ...r.definition, builtin: false, retired: !!r.retired_at, createdAt: r.created_at, uses: Number(r.uses) }))
    .filter((l) => o.includeRetired || !l.retired);
  const builtinUses = async (id: string) => Number((await q.query<{ n: string }>(`SELECT count(*) n FROM import_batch WHERE layout_id=$1`, [id])).rows[0].n);
  const builtin = await Promise.all(BUILTIN.map(async (l) => ({ ...l, builtin: true, retired: false, createdAt: null, uses: await builtinUses(l.id) })));
  return [...builtin, ...saved].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLayout(q: Q, id: string, version?: number): Promise<Layout | null> {
  const b = BUILTIN.find((l) => l.id === id); if (b) return b;
  const r = (await q.query<{ definition: Layout }>(
    `SELECT definition FROM import_layout WHERE id=$1 ${version ? 'AND version=$2' : ''} ORDER BY version DESC LIMIT 1`, version ? [id, version] : [id])).rows[0];
  return r?.definition ?? null;
}

export async function retireLayout(q: Q, id: string, userId: string | null): Promise<void> {
  if (BUILTIN.some((l) => l.id === id)) throw new WizardError('Built-in maps cannot be retired.');
  await q.query(`UPDATE import_layout SET retired_at=now() WHERE id=$1 AND retired_at IS NULL`, [id]);
  await q.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'import_layout_retired','import_layout',$2,'{}')`, [userId, id]);
}

// ---------- files waiting in the wizard ----------
export interface Upload { id: string; propertyId: string; filename: string | null; bytes: Uint8Array; state: WizardState; createdAt: string }

export async function createUpload(db: Db, propertyId: string, filename: string | null, bytes: Uint8Array, userId: string | null): Promise<{ id: string; matched: string | null }> {
  await db.query(`UPDATE import_upload SET bytes=NULL WHERE bytes IS NOT NULL AND created_at < now() - interval '7 days'`);
  const sheets = await readSheets(bytes);
  if (!sheets.some((s) => s.rows.length)) throw new WizardError('The file has no rows.');
  const saved = (await listLayouts(db)).filter((l) => !l.builtin);
  const top = matchLayouts(sheets, [...BUILTIN, ...saved])[0];
  let state: WizardState;
  if (top && top.score === 1) state = { target: top.layout.target, layoutId: top.layout.id, layoutVersion: top.layout.version, overrides: { sheet: top.sheet, headerRow: top.headerRow } };
  else { const sheet = sheets.find((s) => s.rows.length) ?? sheets[0]; state = { overrides: { sheet: sheet.name, headerRow: guessHeaderRow(sheet.rows) } }; }
  const r = await db.query<{ id: string }>(`INSERT INTO import_upload (property_id,filename,bytes,state,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [propertyId, filename, bytes, JSON.stringify(state), userId]);
  return { id: r.rows[0].id, matched: state.layoutId ? top!.layout.name : null };
}

export async function getUpload(q: Q, id: string): Promise<Upload> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new WizardError('Unknown upload.');
  const r = (await q.query<{ id: string; property_id: string; filename: string | null; bytes: Uint8Array | null; state: WizardState; created_at: string }>(
    `SELECT id, property_id, filename, bytes, state, created_at::text FROM import_upload WHERE id=$1`, [id])).rows[0];
  if (!r) throw new WizardError('Unknown upload.');
  if (!r.bytes) throw new WizardError('This file was already imported, discarded, or kept longer than 7 days. Upload it again.');
  return { id: r.id, propertyId: r.property_id, filename: r.filename, bytes: r.bytes, state: { ...r.state, overrides: r.state.overrides ?? {} }, createdAt: r.created_at };
}

export async function saveState(q: Q, id: string, state: WizardState): Promise<void> {
  await q.query(`UPDATE import_upload SET state=$2 WHERE id=$1 AND bytes IS NOT NULL`, [id, JSON.stringify(state)]);
}

export async function discardUpload(q: Q, id: string): Promise<void> { await q.query(`UPDATE import_upload SET bytes=NULL WHERE id=$1`, [id]); }

/** Columns suggested from header names: exact matches only (after ignoring case and punctuation), each column once. */
export function suggestColumns(target: Target, header: Cell[]): Record<string, number> {
  const fields = TARGETS[target].fields; const out: Record<string, number> = {}; const used = new Set<number>();
  const names = header.map(normHeader);
  for (const f of fields) {
    const want = [...(f.aliases ?? []), f.label, ...BUILTIN.filter((l) => l.target === target).flatMap((l) => l.columns.filter((c) => c.field === f.key).flatMap((c) => c.headers))].map(normHeader);
    const i = names.findIndex((h, k) => h && !used.has(k) && want.includes(h));
    if (i >= 0) { out[f.key] = i + 1; used.add(i); }
  }
  return out;
}

export const blankLayout = (target: Target): Layout => ({ id: 'new', name: 'New map', version: 0, target, columns: [], emptyWhen: TARGETS[target].emptyWhen });

/** Choose what the file is: a saved map, or a new map for a target (columns suggested, to be checked). */
export function chooseTarget(state: WizardState, header: Cell[], choice: { layout?: Layout | null; target?: Target }): WizardState {
  const keep = { sheet: state.overrides.sheet, headerRow: state.overrides.headerRow };
  if (choice.layout) return { target: choice.layout.target, layoutId: choice.layout.id, layoutVersion: choice.layout.version, overrides: keep };
  if (!choice.target || !TARGETS[choice.target]) throw new WizardError('Choose what this file holds.');
  return { target: choice.target, overrides: { ...keep, columns: suggestColumns(choice.target, header) }, suggested: true };
}

// ---------- what the wizard page shows ----------
export interface WizardView {
  upload: { id: string; propertyId: string; filename: string | null; createdAt: string };
  sheets: { name: string; rows: number }[];
  sheet: string; headerRow: number;
  grid: string[][];                                  // first rows of the chosen sheet, as text
  columns: { n: number; header: string; samples: string[] }[];
  candidates: { id: string; name: string; version: number; score: number; builtin: boolean }[];
  base: { id: string; name: string; version: number; builtin: boolean } | null;
  target: Target | null;
  preview: Preview | null;
  /** Values that could not be read, per field, for the "read this as" table. */
  problemValues: Record<string, { raw: string; count: number; message: string }[]>;
  state: WizardState;
  changed: boolean;
}

export async function wizardView(db: Db, id: string): Promise<WizardView> {
  const u = await getUpload(db, id); const st = u.state;
  const sheets = await readSheets(u.bytes);
  const sheet = sheets.find((s) => s.name === st.overrides.sheet) ?? sheets.find((s) => s.rows.length) ?? sheets[0];
  const headerRow = st.overrides.headerRow ?? guessHeaderRow(sheet.rows);
  const header = sheet.rows[headerRow - 1] ?? [];
  const width = Math.max(header.length, ...sheet.rows.slice(headerRow, headerRow + 200).map((r) => r?.length ?? 0));
  const columns = Array.from({ length: width }, (_, i) => ({
    n: i + 1, header: text(header[i]),
    samples: sheet.rows.slice(headerRow).map((r) => text(r?.[i])).filter(Boolean).slice(0, 3).map((x) => (x.length > 40 ? x.slice(0, 40) + '…' : x)),
  }));
  const saved = (await listLayouts(db)).filter((l) => !l.builtin);
  const all = [...BUILTIN, ...saved];
  const candidates = matchLayouts(sheets, all).map((c) => ({ id: c.layout.id, name: c.layout.name, version: c.layout.version, score: c.score, builtin: BUILTIN.includes(c.layout) }))
    .filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
  const base = st.layoutId ? await getLayout(db, st.layoutId, st.layoutVersion) : null;
  const target = base?.target ?? st.target ?? null;
  let pv: Preview | null = null;
  if (target) pv = preview(sheets, base ?? blankLayout(target), { ...st.overrides, sheet: sheet.name, headerRow }, await ctxOf(db));
  const problemValues: WizardView['problemValues'] = {};
  for (const p of pv?.problems ?? []) {
    if (!p.raw || p.message.startsWith('same as')) continue;
    const list = (problemValues[p.field] ??= []); const hit = list.find((x) => x.raw === p.raw);
    if (hit) hit.count++; else if (list.length < 20) list.push({ raw: p.raw, count: 1, message: p.message });
  }
  return {
    upload: { id: u.id, propertyId: u.propertyId, filename: u.filename, createdAt: u.createdAt },
    sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })), sheet: sheet.name, headerRow,
    grid: sheet.rows.slice(0, 15).map((r) => (r ?? []).slice(0, width).map((c) => { const t = text(c); return t.length > 30 ? t.slice(0, 30) + '…' : t; })),
    columns, candidates,
    base: base ? { id: base.id, name: base.name, version: base.version, builtin: BUILTIN.includes(base) } : null,
    target, preview: pv, problemValues, state: st,
    changed: !base || hasKeys(st.overrides.columns) || hasKeys(st.overrides.constants) || hasKeys(st.overrides.lookups),
  };
}

// ---------- saving a map ----------
/** The map to save from what the person chose for this file. Row exclusions are per file and are not saved. */
export function buildLayout(v: WizardView, base: Layout | null, meta: { id: string; name: string; version: number; source?: string }): Layout {
  const o = v.state.overrides; const target = TARGETS[v.target!];
  const columns: ColumnRule[] = [];
  for (const f of target.fields) {
    const prev = base?.columns.find((c) => c.field === f.key);
    const lookup = { ...(prev?.lookup ?? {}), ...(o.lookups?.[f.key] ?? {}) };
    const lk = Object.keys(lookup).length ? lookup : undefined;
    const constant = o.constants?.[f.key]?.trim();
    if (constant) { columns.push({ field: f.key, headers: [], default: constant, lookup: lk }); continue; }
    const mapped = v.preview!.columns.find((c) => c.field === f.key);
    if (!mapped?.column) { if (prev?.default !== undefined) columns.push({ field: f.key, headers: [], default: prev.default, lookup: lk }); continue; }
    if (!mapped.header) throw new WizardError(`Column ${mapped.column} (${f.label}) has no header name. A saved map finds columns by header, so pick a header row that names every column used.`);
    columns.push({ field: f.key, headers: [mapped.header], required: f.required || prev?.required || undefined, default: prev?.default, lookup: lk });
  }
  const signature = columns.flatMap((c) => c.headers);
  return { id: meta.id, name: meta.name, version: meta.version, target: v.target!, source: meta.source ?? base?.source, columns, signature,
    emptyWhen: target.emptyWhen, headerWithin: Math.max(15, v.headerRow + 5) };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'map';

export interface WizardResult { result: ImportResult; layout: { id: string; name: string; version: number } }

/**
 * Import the file as previewed. A changed or new map must be saved: give `saveAs` for a new map, or leave it
 * blank to save the changes as the next version of the saved map in use. Built-in maps are never changed.
 */
export async function commitWizard(db: Db, id: string, o: { saveAs?: string | null; createMissing?: boolean; userId: string | null }): Promise<WizardResult> {
  const v = await wizardView(db, id); const u = await getUpload(db, id);
  if (!v.target || !v.preview) throw new WizardError('Choose what this file holds first.');
  if (v.state.suggested) throw new WizardError('Check the suggested columns and press "Use these columns" first.');
  if (!v.preview.importable) throw new WizardError(v.preview.blocking[0] ?? (v.preview.rejected.length ? `${v.preview.rejected.length} row(s) cannot be read. Fix them or leave them out first.` : 'Nothing to import.'));
  if (v.preview.excluded.length && !v.state.excludeReason?.trim()) throw new WizardError('Say why the left-out rows are left out.');

  const base = v.state.layoutId ? await getLayout(db, v.state.layoutId, v.state.layoutVersion) : null;
  const isBuiltin = !!base && BUILTIN.includes(base);
  let layout: Layout = base!; let save = false;
  if (v.changed) {
    const name = o.saveAs?.trim();
    if (name) layout = buildLayout(v, base, { id: `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`, name, version: 1 });
    else if (base && !isBuiltin) layout = buildLayout(v, base, { id: base.id, name: base.name, version: base.version + 1 });
    else throw new WizardError(isBuiltin ? 'This changes a built-in map. Give the new map a name to save it as.' : 'Name this map so the next file like it is recognised.');
    if (name && (await listLayouts(db)).some((l) => l.name.toLowerCase() === name.toLowerCase())) throw new WizardError(`A map named "${name}" already exists. Choose another name, or open that map.`);
    save = true;
    // The saved map, on its own, must read this file exactly as the preview did.
    const sheets = await readSheets(u.bytes);
    const again = preview(sheets, layout, { sheet: v.sheet, headerRow: v.headerRow, excludeRows: v.state.overrides.excludeRows }, await ctxOf(db));
    if (!again.importable || JSON.stringify({ ...again.parsed, warnings: [] }) !== JSON.stringify({ ...v.preview.parsed, warnings: [] }))
      throw new WizardError('The map to be saved would read this file differently from the preview. Nothing was imported. Check columns that share a header name.');
  }

  const result = await importParsed(db, v.upload.propertyId, v.preview.parsed!, { createMissing: !!o.createMissing, importedBy: o.userId ?? undefined, filename: v.upload.filename ?? undefined, fileBytes: u.bytes });
  await db.transaction(async (tx) => {
    if (save) {
      await tx.query(`INSERT INTO import_layout (id,version,name,target,definition,created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [layout.id, layout.version, layout.name, layout.target, JSON.stringify(layout), o.userId]);
      await tx.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'import_layout_saved','import_layout',$2,$3)`,
        [o.userId, layout.id, JSON.stringify({ name: layout.name, version: layout.version })]);
    }
    if (result.batchId && !result.duplicate)
      await tx.query(`UPDATE import_batch SET layout_id=$2, layout_version=$3, import_overrides=$4 WHERE id=$1`,
        [result.batchId, layout.id, layout.version, JSON.stringify({ ...v.state.overrides, excludeReason: v.state.excludeReason ?? null })]);
    await tx.query(`UPDATE import_upload SET bytes=NULL, import_batch_id=$2 WHERE id=$1`, [id, result.batchId ?? null]);
  });
  return { result, layout: { id: layout.id, name: layout.name, version: layout.version } };
}

export const fieldLabel = (target: Target, key: string) => TARGETS[target].fields.find((f) => f.key === key)?.label ?? key;

/**
 * Apply the column choices from the wizard form. On a saved map only the fields a person actually changed become
 * overrides, so an unchanged map stays unchanged; on a new map every choice is kept. Confirms suggested columns.
 */
export async function setColumns(db: Db, id: string, choices: Record<string, { column: number | null; constant: string }>): Promise<void> {
  const u = await getUpload(db, id); const st = u.state;
  const base = st.layoutId ? await getLayout(db, st.layoutId, st.layoutVersion) : null;
  const target = base?.target ?? st.target; if (!target) throw new WizardError('Choose what this file holds first.');
  let resolved: Record<string, number | null> = {};
  if (base) {
    const sheets = await readSheets(u.bytes);
    const p = preview(sheets, base, { sheet: st.overrides.sheet, headerRow: st.overrides.headerRow }, await ctxOf(db));
    resolved = Object.fromEntries(p.columns.map((c) => [c.field, c.column]));
  }
  const columns: Record<string, number | null> = {}; const constants: Record<string, string> = {};
  for (const f of TARGETS[target].fields) {
    const c = choices[f.key]; if (!c) continue;
    if (c.constant.trim()) { constants[f.key] = c.constant.trim(); if (base) columns[f.key] = null; continue; }
    if (!base || c.column !== resolved[f.key]) columns[f.key] = c.column;
  }
  await saveState(db, id, { ...st, suggested: false, overrides: { ...st.overrides, columns, constants } });
}

/** "Read this value as": add lookups for values that could not be read. Blank answers are ignored. */
export async function addLookups(db: Db, id: string, field: string, pairs: { raw: string; as: string }[]): Promise<void> {
  const u = await getUpload(db, id); const st = u.state;
  const cur = { ...(st.overrides.lookups?.[field] ?? {}) };
  for (const p of pairs) if (p.as.trim()) cur[p.raw] = p.as.trim();
  await saveState(db, id, { ...st, overrides: { ...st.overrides, lookups: { ...(st.overrides.lookups ?? {}), [field]: cur } } });
}

export async function setExcluded(db: Db, id: string, rows: number[], reason: string | null): Promise<void> {
  const u = await getUpload(db, id); const st = u.state;
  if (rows.length && !reason?.trim()) throw new WizardError('Say why these rows are left out.');
  await saveState(db, id, { ...st, excludeReason: rows.length ? reason!.trim() : undefined, overrides: { ...st.overrides, excludeRows: rows.length ? rows : undefined } });
}

/** Pick the sheet and header row. On a new map the columns are suggested again from the new header. */
export async function setTable(db: Db, id: string, sheet: string, headerRow: number): Promise<void> {
  const u = await getUpload(db, id); const st = u.state;
  const sheets = await readSheets(u.bytes); const s = sheets.find((x) => x.name === sheet);
  if (!s) throw new WizardError(`Sheet "${sheet}" is not in the file.`);
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > s.rows.length) throw new WizardError(`The header row must be between 1 and ${s.rows.length}.`);
  const moved = st.overrides.sheet !== sheet || st.overrides.headerRow !== headerRow;
  const next: WizardState = { ...st, overrides: { ...st.overrides, sheet, headerRow } };
  if (moved && !st.layoutId && st.target) { next.overrides.columns = suggestColumns(st.target, s.rows[headerRow - 1] ?? []); next.overrides.constants = undefined; next.suggested = true; }
  if (moved) { next.overrides.excludeRows = undefined; next.excludeReason = undefined; }
  await saveState(db, id, next);
}
