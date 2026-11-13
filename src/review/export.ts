// Outputs of a reviewed audit: CSV and Excel for people, and a corpus case (raw files + signed-off audit) for the evaluation harness.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { Db } from '../db';
import type { AuditLine } from '../queries/audit';

const HEAD = ['Building', 'Unit', 'Address', 'Service', 'Audit result', 'Action', 'Owner', 'Component', 'Reviewer note', 'Changed by reviewer', 'Rules said'];
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const rowOf = (l: AuditLine) => [l.building, l.unit, l.address ?? '', l.service, l.code, l.recommendation.action, l.recommendation.owner ?? '', l.recommendation.component ?? '',
  l.override?.reason ?? '', l.override ? 'Yes' : '', l.override ? l.rules.action : ''];

export function auditCsv(lines: AuditLine[], onlyActionable = false): string {
  const rows = lines.filter((l) => !onlyActionable || l.recommendation.action !== 'No action').map(rowOf);
  return [HEAD, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export async function auditXlsx(lines: AuditLine[], title: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Audit');
  ws.addRow([title]).font = { bold: true };
  ws.addRow(HEAD).font = { bold: true };
  for (const l of lines) ws.addRow(rowOf(l));
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: HEAD.length } };
  [10, 10, 34, 8, 12, 15, 18, 14, 40, 10, 15].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** corpus/<case>/ as a zip: raw files in import order, case.json, expected.csv (actionable rows only), and reviewer-notes.csv. */
export async function caseZip(db: Db, batchId: string, lines: AuditLine[]): Promise<{ name: string; bytes: Uint8Array }> {
  const b = (await db.query<{ property_id: string; imported_at: string; class_id: string; installed_by_us: boolean; install_completed_on: string | null }>(
    `SELECT i.property_id, i.imported_at::text, p.class_id, p.installed_by_us, p.install_completed_on::text FROM import_batch i JOIN property p ON p.id=i.property_id WHERE i.id=$1`, [batchId])).rows[0];
  if (!b) throw new Error('Unknown import.');
  const raws = (await db.query<{ id: string; kind: string; filename: string | null; raw_file: Uint8Array | null }>(
    `SELECT id, kind, filename, raw_file FROM import_batch WHERE property_id=$1 AND imported_at <= $2 AND raw_file IS NOT NULL ORDER BY imported_at, id`, [b.property_id, b.imported_at])).rows;
  if (!raws.some((r) => r.id === batchId)) throw new Error('The raw file for this audit has been discarded (180-day retention), so a case cannot be built from it.');
  const zip = new JSZip();
  const files: { file: string; purpose?: string }[] = [];
  raws.forEach((r, i) => {
    const safe = (r.filename ?? `${r.kind}.xlsx`).replace(/[^\w.\-]+/g, '_');
    const path = `raw/${String(i + 1).padStart(2, '0')}-${safe}`;
    zip.file(path, r.raw_file!);
    files.push(r.kind === 'occupancy' ? { file: path, purpose: 'occupancy' } : { file: path });
  });
  const asOf = b.imported_at.slice(0, 10);
  const name = `real-${b.class_id}-${asOf}`;
  const changed = lines.filter((l) => l.override).length;
  zip.file('case.json', JSON.stringify({ name, brand: '', classId: b.class_id, asOf, installedByUs: b.installed_by_us, installCompletedOn: b.install_completed_on, files,
    notes: `Exported from the review screen. ${changed} of ${lines.length} rows changed by the reviewer. Fill in "brand".` }, null, 2));
  zip.file('expected.csv', ['building,unit,service,action,owner,component',
    ...lines.filter((l) => l.recommendation.action !== 'No action').map((l) => [l.building, l.unit, l.service, l.recommendation.action, l.recommendation.owner ?? '', l.recommendation.component ?? ''].map(cell).join(','))].join('\n') + '\n');
  zip.file('reviewer-notes.csv', ['building,unit,service,audit_result,rules_said,final,reason',
    ...lines.filter((l) => l.override).map((l) => [l.building, l.unit, l.service, l.code, l.rules.action, l.recommendation.action, l.override!.reason].map(cell).join(','))].join('\n') + '\n');
  return { name, bytes: await zip.generateAsync({ type: 'uint8array' }) };
}
