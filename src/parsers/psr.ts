import { Grid, Cell, Sheet, str, parseDate, findRow, headerMap, ParseError } from './common';

export interface PsrEquipment {
  kind: 'collector' | 'repeater';
  label: string;                    // "Collector", "Repeater 3"
  installedOn: string;
  location: string | null;
  serial: string | null;
}

export interface PsrUnit {
  building: string;
  unit: string;
  installedOn: string;
  transmitterId: string | null;
  meterId: string | null;
  imr: string | null;
  meterModel: string | null;
  issues: string | null;
}

export interface PsrParse {
  kind: 'psr';
  sheet: 'PSR' | 'PSR CA';
  project: string | null;
  projectNumber: string | null;
  completedOn: string | null;       // latest install date: the single major-completion date
  equipment: PsrEquipment[];
  units: PsrUnit[];
  skippedNoDate: string[];          // lines with no install date, which the rule treats as not installed
  warnings: string[];
}

const at = (r: Cell[], i: number | undefined): Cell => (i === undefined ? null : (r[i] ?? null));

/** Value right of a label in columns B..E (column F onward holds the 1..10 lists). */
function labelValue(rows: Grid, label: string): string | null {
  const i = findRow(rows, (r) => (str(r[0]) ?? '').toLowerCase().startsWith(label.toLowerCase()), 0, 15);
  if (i < 0) return null;
  for (let c = 1; c <= 4; c++) { const v = str(rows[i][c]); if (v) return v; }
  return null;
}

/** Count rows carrying an install date, used to pick between the PSR and PSR CA tabs. */
function dateCount(rows: Grid): number {
  let n = 0;
  const unitHdr = findRow(rows, (r) => str(r[0])?.toLowerCase() === 'bldg #');
  const eqHdr = findRow(rows, (r) => str(r[0])?.toLowerCase() === 'equipment');
  for (let i = Math.max(eqHdr, 0) + 1; i < rows.length; i++) {
    if (i === unitHdr) continue;
    if (parseDate(rows[i]?.[2] ?? null)) n++;
  }
  return n;
}

/** A property uses either the PSR or the PSR CA tab, never both. Rows count only with an install date. */
export function parsePsr(sheets: Sheet[]): PsrParse {
  const candidates = sheets.filter((s) => s.name === 'PSR' || s.name === 'PSR CA');
  if (!candidates.length) throw new ParseError('No PSR or PSR CA tab found.');
  const best = candidates.map((s) => ({ s, n: dateCount(s.rows) })).sort((a, b) => b.n - a.n)[0];
  const warnings: string[] = [];
  if (candidates.length > 1 && candidates.every((c) => dateCount(c.rows) > 0)) {
    warnings.push('Both PSR and PSR CA contain dates; using the one with more.');
  }
  const rows = best.s.rows;
  const eqHdr = findRow(rows, (r) => str(r[0])?.toLowerCase() === 'equipment');
  const unitHdr = findRow(rows, (r) => str(r[0])?.toLowerCase() === 'bldg #' && str(r[1])?.toLowerCase() === 'unit #');
  if (eqHdr < 0 || unitHdr < 0) throw new ParseError('PSR layout not recognised (Equipment / Bldg # header rows missing).');

  const equipment: PsrEquipment[] = [];
  const skipped: string[] = [];
  for (let i = eqHdr + 1; i < unitHdr; i++) {
    const r = rows[i] ?? [];
    const label = str(r[0]);
    if (!label) continue;
    const lower = label.toLowerCase();
    const kind = lower.startsWith('collector') ? 'collector' : lower.startsWith('repeater') ? 'repeater' : null;
    if (!kind) continue;
    const installedOn = parseDate(r[2] ?? null);
    if (!installedOn) { skipped.push(label); continue; }
    equipment.push({ kind, label, installedOn, location: str(r[3]), serial: str(r[11]) });
  }

  const h = headerMap(rows[unitHdr]);
  const units: PsrUnit[] = [];
  let blanks = 0;
  for (let i = unitHdr + 1; i < rows.length && blanks < 25; i++) {
    const r = rows[i] ?? [];
    const b = str(at(r, h.get('bldg #')));
    const u = str(at(r, h.get('unit #')));
    if (!b && !u) { blanks++; continue; }
    blanks = 0;
    const installedOn = parseDate(at(r, h.get('install date')));
    if (!installedOn) { skipped.push(`${b ?? ''}-${u ?? ''}`); continue; }
    units.push({
      building: b ?? '', unit: u ?? '', installedOn,
      transmitterId: str(at(r, h.get('transmitter id'))),
      meterId: str(at(r, h.get('meter ids'))),
      imr: str(at(r, h.get('imc/imr'))),
      meterModel: str(at(r, h.get('meter type'))),
      issues: str(at(r, h.get('issues/comments'))),
    });
  }

  const all = [...equipment.map((e) => e.installedOn), ...units.map((u) => u.installedOn)].sort();
  return {
    kind: 'psr',
    sheet: best.s.name as 'PSR' | 'PSR CA',
    project: labelValue(rows, 'Project:'),
    projectNumber: labelValue(rows, 'Project #'),
    completedOn: all.length ? all[all.length - 1] : null,
    equipment, units, skippedNoDate: skipped, warnings,
  };
}
