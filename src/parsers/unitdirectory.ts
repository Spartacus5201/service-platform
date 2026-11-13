// Unit Directory export (CSV): who has lived in each unit since when. Only building, unit and the dates are read.
// Resident name, account number, balance and customer ID are skipped on purpose and never leave this function.
import { parseCsv, parseDate, normLabel, ParseError } from './common';

export interface UnitDirectoryRow { building: string; unit: string; moveInOn: string | null; priorMoveOutOn: string | null; vacant: boolean }
export interface UnitDirectoryParse { kind: 'unit_directory'; classId: string | null; rows: UnitDirectoryRow[]; warnings: string[] }

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

/** True when the text looks like a Unit Directory export. */
export function isUnitDirectory(text: string): boolean {
  const first = parseCsv(text.replace(/^﻿/, '').slice(0, 2000))[0];
  const h = new Set((first ?? []).map(norm));
  return h.has('bldg') && h.has('unit') && h.has('startdate');
}

export function parseUnitDirectory(text: string): UnitDirectoryParse {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const head = (rows[0] ?? []).map(norm);
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const b = col('bldg', 'building'); const u = col('unit'); const s = col('startdate'); const e = col('enddate'); const occ = col('occ');
  if (b < 0 || u < 0 || s < 0) throw new ParseError('Unit Directory needs Bldg #, Unit # and Start Date columns.');
  const out: UnitDirectoryRow[] = []; const warnings: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const building = (r[b] ?? '').trim(); const unit = (r[u] ?? '').trim();
    if (!unit) return;
    const start = parseDate(r[s]); const end = e >= 0 ? parseDate(r[e]) : null;
    if ((r[s] ?? '').trim() && !start) warnings.push(`Row ${i + 2}: start date "${r[s]}" not understood; unit treated as vacant.`);
    const noOcc = occ >= 0 && ['null', '0'].includes((r[occ] ?? '').trim().toLowerCase());
    const vacant = !start || !!end || noOcc;
    out.push({ building, unit, moveInOn: vacant ? null : start, priorMoveOutOn: end, vacant });
  });
  if (!out.length) throw new ParseError('Unit Directory has no unit rows.');
  void normLabel;
  return { kind: 'unit_directory', classId: null, rows: out, warnings };
}
