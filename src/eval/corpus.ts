// Golden-pair evaluation: raw report files in, the audit a person signed off on out. Measures how far the program is from it.
// Case folder:  case.json  raw/<files>  expected.csv
//   case.json: { "name", "brand", "classId", "asOf": "YYYY-MM-DD", "installedByUs": bool, "installCompletedOn": "YYYY-MM-DD"|null,
//                "files": [ { "file": "raw/x.xlsx", "purpose": "report" | "occupancy" } ], "notes": "" }
//   expected.csv: building,unit,service,action[,owner,component]. Rows left out mean "No action".
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../db';
import { parseFile, normLabel, parseCsv } from '../parsers';
import { importParsed } from '../import/commit';
import { auditLines } from '../queries/audit';

export interface CaseDef {
  name?: string; brand?: string; classId: string; asOf: string; installedByUs?: boolean; installCompletedOn?: string | null;
  files: { file: string; purpose?: 'report' | 'occupancy' }[]; notes?: string;
}
export interface Row { building: string; unit: string; service: string; action: string; owner: string; component: string }
export interface Mismatch { key: string; expected: Row | null; actual: Row | null; kind: 'action' | 'owner' | 'component' | 'missing' | 'extra'; code?: string }
export interface CaseResult { name: string; brand: string; units: number; actionable: number; exact: number; total: number; mismatches: Mismatch[]; warnings: string[] }

export { parseCsv };

const ACTIONS: Record<string, string> = { 'no action': 'No action', 'needs service': 'Needs Service', 'verify id': 'Verify ID', 'investigate': 'Investigate', 'requested by property': 'Requested by property', 'unrecognized': 'Unrecognized' };
const key = (r: { building: string; unit: string; service: string }) => `${normLabel(r.building)}|${normLabel(r.unit)}|${r.service.trim().toUpperCase()}`;

export function loadExpected(csv: string): Map<string, Row> {
  const rows = parseCsv(csv); const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  for (const n of ['building', 'unit', 'service', 'action']) if (col(n) < 0) throw new Error(`expected.csv is missing the "${n}" column.`);
  const out = new Map<string, Row>();
  for (const r of rows.slice(1)) {
    const get = (n: string) => (col(n) >= 0 ? (r[col(n)] ?? '').trim() : '');
    const action = ACTIONS[get('action').toLowerCase()];
    if (!action) throw new Error(`expected.csv: unknown action "${get('action')}" for ${get('building')}-${get('unit')}.`);
    const row: Row = { building: get('building'), unit: get('unit'), service: get('service'), action, owner: get('owner').toLowerCase(), component: get('component').toLowerCase() };
    out.set(key(row), row);
  }
  return out;
}

export async function evalCase(dir: string): Promise<CaseResult> {
  const def = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8')) as CaseDef;
  const expected = loadExpected(readFileSync(join(dir, 'expected.csv'), 'utf8'));
  const db = await openDb();
  try {
    const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name,installed_by_us,install_completed_on) VALUES ($1,$2,$3,$4) RETURNING id`,
      [def.classId, def.name ?? def.classId, def.installedByUs ?? false, def.installCompletedOn ?? null])).rows[0].id;
    let batch: string | undefined; const warnings: string[] = [];
    for (const f of def.files) {
      const parsed = await parseFile(new Uint8Array(readFileSync(join(dir, f.file))));
      const r = await importParsed(db, pid, parsed, { createMissing: true, as: f.purpose === 'occupancy' ? 'occupancy' : undefined, filename: f.file });
      warnings.push(...r.warnings.map((w) => `${f.file}: ${w}`));
      if ((r.kind === 'auto_audit' || r.kind === 'manual_audit') && r.batchId) batch = r.batchId;
    }
    if (!batch) throw new Error('No audit report among the case files.');
    const lines = await auditLines(db, batch, def.asOf);
    const actual = new Map<string, Row>(); const codes = new Map<string, string>();
    for (const l of lines) {
      const row: Row = { building: l.building, unit: l.unit, service: l.service, action: l.recommendation.action, owner: l.recommendation.owner ?? '', component: l.recommendation.component ?? '' };
      actual.set(key(row), row); codes.set(key(row), l.code);
    }
    const mismatches: Mismatch[] = []; let exact = 0;
    const keys = new Set([...actual.keys(), ...expected.keys()]);
    for (const k of keys) {
      const a = actual.get(k) ?? null; const e = expected.get(k) ?? null;
      if (!a) { mismatches.push({ key: k, expected: e, actual: null, kind: 'missing' }); continue; }
      const ea = e?.action ?? 'No action';
      if (!e && a.action === 'No action') { exact++; continue; }
      if (!e) { mismatches.push({ key: k, expected: null, actual: a, kind: 'extra', code: codes.get(k) }); continue; }
      if (ea !== a.action) { mismatches.push({ key: k, expected: e, actual: a, kind: 'action', code: codes.get(k) }); continue; }
      if (e.owner && e.owner !== a.owner) { mismatches.push({ key: k, expected: e, actual: a, kind: 'owner', code: codes.get(k) }); continue; }
      if (e.component && e.component !== a.component) { mismatches.push({ key: k, expected: e, actual: a, kind: 'component', code: codes.get(k) }); continue; }
      exact++;
    }
    return { name: def.name ?? dir, brand: def.brand ?? '', units: lines.length, actionable: [...expected.values()].filter((x) => x.action !== 'No action').length, exact, total: keys.size, mismatches, warnings };
  } finally { await db.close(); }
}

export function caseDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'case.json'))).map((d) => join(root, d.name)).sort();
}
