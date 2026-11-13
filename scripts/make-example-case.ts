// Writes corpus/example-synthetic (invented data) so the harness has something to run. Real cases are made by hand; see corpus/README.md.
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { synthUnits, synthAutoAudit, SYNTH_CLASS_ID } from '../src/dev/synthetic';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { auditLines } from '../src/queries/audit';

const dir = 'corpus/example-synthetic';
mkdirSync(`${dir}/raw`, { recursive: true });
const units = synthUnits();
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Audit');
for (const r of synthAutoAudit(units)) ws.addRow(r as never);
await wb.xlsx.writeFile(`${dir}/raw/auto-audit.xlsx`);
writeFileSync(`${dir}/case.json`, JSON.stringify({ name: 'example-synthetic', brand: 'synthetic', classId: SYNTH_CLASS_ID, asOf: '2026-11-06', installedByUs: false,
  files: [{ file: 'raw/auto-audit.xlsx' }], notes: 'Invented data. Expected rows were written from the rules, so this only proves the harness; real cases must be signed off by a person.' }, null, 2));
const db = await openDb();
const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'x') RETURNING id`, [SYNTH_CLASS_ID])).rows[0].id;
const r = await importParsed(db, pid, parseAutoAudit(synthAutoAudit(units)), { createMissing: true });
const lines = (await auditLines(db, r.batchId!, '2026-11-06')).filter((l) => l.recommendation.action !== 'No action');
writeFileSync(`${dir}/expected.csv`, ['building,unit,service,action,owner,component', ...lines.map((l) => [l.building, l.unit, l.service, l.recommendation.action, l.recommendation.owner ?? '', l.recommendation.component ?? ''].join(','))].join('\n') + '\n');
await db.close();
console.log(`wrote ${dir} (${lines.length} actionable rows)`);
