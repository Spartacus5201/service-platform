// Apply a layout (plus a person's overrides) to one sheet. Pure: no database, no side effects.
// Every row ends up in exactly one place: rows (kept), empty, excluded (by a person) or rejected (with reasons),
// and every value that could not be read is listed, so the preview can show the whole story.
import type { Cell, Grid, Sheet } from '../parsers/common';
import { convert, type ConvertContext } from './convert';
import { normHeader, normValue, type Layout, type Overrides } from './layout';
import { TARGETS, type Values } from './targets';

export interface Problem { row: number; field: string; raw: string; message: string; severity: 'error' | 'warning' }
export interface MappedColumn { field: string; label: string; column: number | null; header: string | null; constant: string | null; required: boolean }
export interface Applied {
  layout: { id: string; name: string; version: number; target: Layout['target'] };
  sheet: string; headerRow: number;
  columns: MappedColumn[];
  /** File headers no field uses. Their values are never read. */
  unused: string[];
  rows: { row: number; values: Values }[];
  empty: number[]; excluded: number[];
  rejected: { row: number; reasons: string[] }[];
  problems: Problem[];
  /** Missing required columns, header not found, etc. When set, nothing can be imported. */
  blocking: string[];
}

const cellText = (c: Cell | undefined) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString() : String(c));

/** 0-based index of the first row (within `within`) that has every required header of the layout, or -1. */
export function findHeaderRow(rows: Grid, layout: Layout): number {
  const need = [...layout.columns.filter((c) => c.required).map((c) => c.headers.map(normHeader)), ...(layout.signature ?? []).map((h) => [normHeader(h)])];
  const within = layout.headerWithin ?? 15;
  for (let i = 0; i < Math.min(rows.length, within); i++) {
    const have = new Set((rows[i] ?? []).map(normHeader));
    if (need.every((alts) => alts.some((h) => have.has(h)))) return i;
  }
  return -1;
}

export function applyLayout(sheet: Sheet, layout: Layout, o: Overrides = {}, ctx?: ConvertContext): Applied {
  const target = TARGETS[layout.target];
  const out: Applied = { layout: { id: layout.id, name: layout.name, version: layout.version, target: layout.target }, sheet: sheet.name, headerRow: 0,
    columns: [], unused: [], rows: [], empty: [], excluded: [], rejected: [], problems: [], blocking: [] };

  const hi = o.headerRow ? o.headerRow - 1 : findHeaderRow(sheet.rows, layout);
  if (hi < 0 || hi >= sheet.rows.length) { out.blocking.push(`The header row for "${layout.name}" was not found in the first ${layout.headerWithin ?? 15} rows of "${sheet.name}". Pick the header row by hand.`); return out; }
  out.headerRow = hi + 1;
  const header = sheet.rows[hi] ?? [];
  const width = Math.max(header.length, ...sheet.rows.slice(hi + 1).map((r) => r?.length ?? 0));
  const byName = new Map<string, number>();
  header.forEach((c, i) => { const k = normHeader(c); if (k && !byName.has(k)) byName.set(k, i); });

  // Resolve each target field to a column, a constant, or nothing.
  const rules = new Map(layout.columns.map((c) => [c.field, c]));
  for (const f of target.fields) {
    const rule = rules.get(f.key);
    const required = !!(rule?.required ?? f.required);
    const constant = o.constants?.[f.key]?.trim() || null;
    let column: number | null = null;
    if (o.columns && f.key in o.columns) {
      const c = o.columns[f.key];
      if (c !== null && (c < 1 || c > width)) out.blocking.push(`${f.label}: column ${c} is outside the sheet (1 to ${width}).`);
      else column = c === null ? null : c - 1;
    } else if (rule) {
      for (const h of rule.headers) { const i = byName.get(normHeader(h)); if (i !== undefined) { column = i; break; } }
    }
    if (column !== null && constant) out.blocking.push(`${f.label} has both a column and a fixed value. Choose one.`);
    if (column === null && !constant && required && rule?.default === undefined)
      out.blocking.push(`${f.label} is required but no column is mapped${rule ? ` (looked for: ${rule.headers.join(', ')})` : ''}.`);
    out.columns.push({ field: f.key, label: f.label, column: column === null ? null : column + 1, header: column === null ? null : cellText(header[column]) || null, constant, required });
  }
  const usedCols = out.columns.map((c) => c.column);
  const dupes = usedCols.filter((c, i) => c !== null && usedCols.indexOf(c) !== i);
  for (const d of new Set(dupes)) out.blocking.push(`Column ${d} is mapped to more than one field: ${out.columns.filter((c) => c.column === d).map((c) => c.label).join(', ')}.`);
  out.unused = header.map((c, i) => ({ c: cellText(c).trim(), i })).filter((x) => x.c && !usedCols.includes(x.i + 1)).map((x) => x.c);
  if (out.blocking.length) return out;

  const exclude = new Set(o.excludeRows ?? []);
  const seen = new Map<string, number>();
  for (let i = hi + 1; i < sheet.rows.length; i++) {
    const r = sheet.rows[i] ?? []; const rowNo = i + 1;
    const raw = (col: MappedColumn): Cell | undefined => (col.constant !== null ? col.constant : col.column === null ? undefined : r[col.column - 1]);
    if (layout.emptyWhen.every((k) => { const c = out.columns.find((x) => x.field === k); return !c || cellText(raw(c)).trim() === ''; })) { out.empty.push(rowNo); continue; }
    if (exclude.has(rowNo)) { out.excluded.push(rowNo); continue; }
    const values: Values = {}; const reasons: string[] = [];
    for (const col of out.columns) {
      const f = target.fields.find((x) => x.key === col.field)!; const rule = rules.get(col.field);
      let v: Cell | undefined = raw(col);
      let text = cellText(v).trim();
      if (text === '' && rule?.default !== undefined) { v = rule.default; text = rule.default; }
      const map = { ...(rule?.lookup ?? {}), ...(o.lookups?.[col.field] ?? {}) };
      const hit = text !== '' ? Object.entries(map).find(([k]) => normValue(k) === normValue(text)) : undefined;
      if (hit) v = hit[1];
      const c = convert(f.type, v, ctx);
      if (!c.ok) {
        if (col.required) { reasons.push(`${f.label}: ${c.error}`); out.problems.push({ row: rowNo, field: f.key, raw: text, message: c.error, severity: 'error' }); }
        else { values[f.key] = null; out.problems.push({ row: rowNo, field: f.key, raw: text, message: `${c.error}; left blank`, severity: 'warning' }); }
        continue;
      }
      if (c.value === null && col.required) { reasons.push(`${f.label} is blank`); out.problems.push({ row: rowNo, field: f.key, raw: '', message: 'blank', severity: 'error' }); continue; }
      values[f.key] = c.value;
    }
    if (reasons.length) { out.rejected.push({ row: rowNo, reasons }); continue; }
    if (target.key) {
      const k = target.key.map((f) => String(values[f] ?? '').toUpperCase().replace(/^0+(?=.)/, '')).join('|');
      const first = seen.get(k);
      if (first) out.problems.push({ row: rowNo, field: target.key.join('+'), raw: k, message: `same as row ${first}`, severity: 'warning' }); else seen.set(k, rowNo);
    }
    out.rows.push({ row: rowNo, values });
  }
  if (!out.rows.length && !out.rejected.length) out.blocking.push('No data rows under the header.');
  return out;
}
