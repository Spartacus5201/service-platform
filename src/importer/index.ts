// The importer: find the layout that fits a file, apply it with any overrides, and hand back a preview
// plus the parse result for the existing commit step. A file is only importable when nothing blocks it
// and no row is rejected; a person resolves rejected rows by fixing a mapping or excluding them.
import type { Sheet } from '../parsers/common';
import { normHeader, type Layout, type Overrides } from './layout';
import { applyLayout, findHeaderRow, type Applied } from './apply';
import { TARGETS } from './targets';
import { BUILTIN } from './builtin';
import type { CimParse } from '../parsers/cim';
import type { UnitDirectoryParse } from '../parsers/unitdirectory';

export * from './layout'; export * from './apply'; export * from './convert'; export { TARGETS } from './targets'; export { BUILTIN, AMR_STATUS, UNIT_DIRECTORY } from './builtin';

export interface Candidate { layout: Layout; sheet: string; headerRow: number; score: number; missingOptional: string[]; extraHeaders: number }

/** Every layout that fits some sheet, best first. Score = share of the layout's columns found. */
export function matchLayouts(sheets: Sheet[], layouts: Layout[] = BUILTIN): Candidate[] {
  const out: Candidate[] = [];
  for (const layout of layouts) for (const sheet of sheets) {
    const hi = findHeaderRow(sheet.rows, layout); if (hi < 0) continue;
    const have = new Set((sheet.rows[hi] ?? []).map(normHeader).filter(Boolean));
    const found = layout.columns.filter((c) => c.headers.some((h) => have.has(normHeader(h))));
    const known = new Set(layout.columns.flatMap((c) => c.headers.map(normHeader)));
    out.push({ layout, sheet: sheet.name, headerRow: hi + 1, score: found.length / layout.columns.length,
      missingOptional: layout.columns.filter((c) => !found.includes(c)).map((c) => c.field), extraHeaders: [...have].filter((h) => !known.has(h)).length });
  }
  return out.sort((a, b) => b.score - a.score || a.extraHeaders - b.extraHeaders);
}

export interface Preview extends Applied { importable: boolean; parsed: CimParse | UnitDirectoryParse | null; sample: Applied['rows'] }

export function preview(sheets: Sheet[], layout: Layout, o: Overrides = {}): Preview {
  const sheet = o.sheet ? sheets.find((s) => s.name === o.sheet) : sheets.find((s) => findHeaderRow(s.rows, layout) >= 0) ?? sheets[0];
  if (!sheet) {
    const empty = applyLayout({ name: o.sheet ?? '', rows: [] }, layout, o);
    return { ...empty, blocking: [`Sheet "${o.sheet}" is not in the file.`], importable: false, parsed: null, sample: [] };
  }
  const a = applyLayout(sheet, layout, o);
  const importable = !a.blocking.length && !a.rejected.length && a.rows.length > 0;
  const parsed = importable ? TARGETS[layout.target].build(a.rows.map((r) => r.values)) : null;
  if (parsed) parsed.warnings.push(...a.problems.filter((p) => p.severity === 'warning').map((p) => `Row ${p.row}: ${p.field} ${p.message}.`));
  return { ...a, importable, parsed, sample: a.rows.slice(0, 20) };
}
