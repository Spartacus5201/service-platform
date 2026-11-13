// The final audit as a PDF: header facts, counts, legend, one row per unit that needs a look, then repeaters.
// Dates come from the readings themselves; anything the imports did not supply says "Not available" instead of a placeholder date.
import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db';
import type { AuditLine } from '../queries/audit';

export interface RepeaterRow { hardwareId: string; location: string | null; lastCheckIn: string | null; online: boolean | null }
export interface AuditReportData {
  property: { name: string; classId: string; msa: boolean };
  periodStart: string | null; periodEnd: string | null;
  collector: string;                 // 'Online' | 'Offline' | 'Not available'
  repeaters: RepeaterRow[];
  repeaterDataAvailable: boolean;
  lines: AuditLine[];
}

const OFFLINE_HOURS = 24;

export async function auditReportData(db: Db, batchId: string, lines: AuditLine[]): Promise<AuditReportData> {
  const p = (await db.query<{ id: string; name: string; class_id: string; msa: boolean }>(
    `SELECT p.id, p.name, p.class_id, p.msa FROM import_batch i JOIN property p ON p.id=i.property_id WHERE i.id=$1`, [batchId])).rows[0];
  if (!p) throw new Error('Unknown import.');
  // Either date column can be the earlier one depending on the report layout, so take the span of all of them.
  const all = lines.flatMap((l) => [l.readDate1, l.readDate2]).filter((x): x is string => !!x).sort();

  const latest = async (kind: string) => (await db.query<{ hardware_id: string; location: string | null; at: string | null }>(
    `SELECT DISTINCT ON (d.id) d.hardware_id, d.location, c.checked_in_at::text at
       FROM device d LEFT JOIN device_checkin c ON c.device_id=d.id
      WHERE d.property_id=$1 AND d.kind=$2 AND d.status='active'
      ORDER BY d.id, c.checked_in_at DESC NULLS LAST`, [p.id, kind])).rows;
  const reps = await latest('repeater');
  const ref = reps.map((r) => r.at).filter((x): x is string => !!x).sort().pop() ?? null;
  const repeaters = reps.map((r) => ({
    hardwareId: r.hardware_id, location: r.location, lastCheckIn: r.at,
    online: r.at && ref ? (Date.parse(ref) - Date.parse(r.at)) / 3600000 <= OFFLINE_HOURS : null,
  })).sort((a, b) => (a.location ?? '').localeCompare(b.location ?? '') || a.hardwareId.localeCompare(b.hardwareId, undefined, { numeric: true }));

  const col = (await latest('collector'))[0];
  const collector = col?.at && ref ? ((Date.parse(ref) - Date.parse(col.at)) / 3600000 <= OFFLINE_HOURS ? 'Online' : 'Offline') : 'Not available';
  return { property: { name: p.name, classId: p.class_id, msa: p.msa }, periodStart: all[0] ?? null, periodEnd: all[all.length - 1] ?? null,
    collector, repeaters, repeaterDataAvailable: reps.length > 0, lines };
}

const t = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, '?');
const us = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}` : '');
const INK = '#1a1a1a'; const MUTED = '#5a5a5a'; const LINE = '#c9c9c9'; const SHADE = '#f1f1f1'; const RED = '#c8102e';
const ISSUE: Record<string, string> = { NI: 'No increment', NT: 'No transmission', INT: 'Intermittent', IDMM: 'ID mismatch', HIGH: 'High usage', LOW: 'Low usage', NEG: 'Negative usage', OTHER: 'Other' };
const LEGEND: [string, string][] = [['NI', 'No increment: no usage while the unit is occupied'], ['NT', 'No transmission'], ['INT', 'Intermittent: few reads, none recently'],
  ['IDMM', 'Transmitter ID does not match'], ['HIGH / LOW', 'Usage outside the expected range'], ['Other', 'Anything else, including requests by the property']];

export function periodText(d: AuditReportData): string {
  return d.periodStart && d.periodEnd ? `${us(d.periodStart)} - ${us(d.periodEnd)}` : 'Not available';
}

export function auditCounts(lines: AuditLine[]) {
  const act = lines.filter((l) => l.recommendation.action !== 'No action');
  const n = (f: (l: AuditLine) => boolean) => act.filter(f).length;
  return { issues: act.length, ni: n((l) => l.code === 'NI'), nt: n((l) => l.code === 'NT'), int: n((l) => l.code === 'INT'),
    usage: n((l) => ['HIGH', 'LOW', 'NEG'].includes(l.code)),
    other: n((l) => !['NI', 'NT', 'INT', 'HIGH', 'LOW', 'NEG'].includes(l.code) || l.recommendation.action === 'Requested by property') };
}

function noteFor(l: AuditLine): string {
  const bits: string[] = [];
  if (l.override) bits.push(l.override.reason);
  else if (l.code === 'INT' || l.code === 'NEG') bits.push(l.recommendation.reason);
  if (l.coverage.laborCovered || l.coverage.partCovered) bits.push('Service warranty');
  return bits.join('. ');
}

function asset(name: string): Buffer | null {
  for (const dir of [process.env.ASSETS_DIR ?? '', join(process.cwd(), 'assets')].filter(Boolean)) {
    const p = join(dir, name); if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

export async function renderAuditPdf(d: AuditReportData): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margins: { top: 36, bottom: 40, left: 36, right: 36 }, bufferPages: true,
    info: { Title: `Audit ${d.property.name}`, Author: 'Minol Service Platform' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((res) => doc.on('end', () => res(new Uint8Array(Buffer.concat(chunks)))));
  const left = 36; const width = doc.page.width - 72;
  const bottom = () => doc.page.height - 40;
  const counts = auditCounts(d.lines);

  const banner = asset('minol-header.jpg');
  if (banner) { doc.image(banner, left, 28, { width: 360 }); doc.y = 28 + 360 * (207 / 1758) + 8; } else { doc.font('Helvetica-Bold').fontSize(20).fillColor(RED).text('MINOL', left, 30); }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text('Meter Reading Audit', left, doc.y + 2);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(t(`${d.property.name}  |  ${d.property.classId}`));
  doc.moveDown(0.5);

  // Facts, two columns
  const facts: [string, string][] = [['Audit period', periodText(d)], ['Unit issues', String(counts.issues)], ['Collector status', d.collector],
    ['Repeaters offline', d.repeaterDataAvailable ? String(d.repeaters.filter((r) => r.online === false).length) : 'Not available'],
    ['No increment (NI)', String(counts.ni)], ['No transmission (NT)', String(counts.nt)], ['Intermittent (INT)', String(counts.int)],
    ['High / low usage', String(counts.usage)], ['Other / requested', String(counts.other)], ['Meter service agreement', d.property.msa ? 'Yes' : 'No']];
  const colW = width / 5; const y0 = doc.y;
  facts.forEach(([k, v], i) => {
    const x = left + (i % 5) * colW; const y = y0 + Math.floor(i / 5) * 34;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(t(k), x, y, { width: colW - 8, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(t(v), x, y + 10, { width: colW - 8, lineBreak: false });
  });
  doc.y = y0 + 72;
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(t(LEGEND.map(([a, b]) => `${a}: ${b}`).join('   |   ')), left, doc.y, { width });
  doc.moveDown(0.8);

  // Table
  const cols: [string, number][] = [['Unit address', 150], ['Bldg', 34], ['Unit', 40], ['Util', 30], ['Transmitter ID', 62], ['MIUID', 56], ['Move-in', 46], ['Usage', 36], ['Audit period', 84], ['Issue', 68], ['Recommendation', 78], ['Notes', 0]];
  const used = cols.reduce((s, c) => s + c[1], 0); cols[cols.length - 1][1] = width - used;
  const xs: number[] = []; cols.reduce((x, c) => { xs.push(x); return x + c[1]; }, left);
  const head = () => {
    const y = doc.y; doc.rect(left, y - 2, width, 14).fill(SHADE); doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5);
    cols.forEach((c, i) => doc.text(c[0], xs[i] + 2, y + 1, { width: c[1] - 4, lineBreak: false }));
    doc.y = y + 15;
  };
  const rows = d.lines.filter((l) => l.recommendation.action !== 'No action');
  head();
  if (!rows.length) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No units need action in this audit.', left, doc.y);
  for (const l of rows) {
    const pr = [l.readDate1, l.readDate2].filter((x): x is string => !!x).sort();
    const period = pr.length ? `${us(pr[0])}-${us(pr[pr.length - 1])}` : '';
    const cells = [l.address ?? '', l.building, l.unit, l.service, l.transmitterId ?? '', l.miuid ?? '', us(l.moveInOn), l.usage === null ? '' : String(l.usage), period,
      ISSUE[l.code] ?? l.code, l.recommendation.action, noteFor(l)].map(t);
    doc.font('Helvetica').fontSize(7.5);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i][1] - 4 }))) + 4;
    if (doc.y + h > bottom()) { doc.addPage(); head(); }
    const y = doc.y; doc.fillColor(INK);
    cells.forEach((c, i) => doc.text(c, xs[i] + 2, y, { width: cols[i][1] - 4 }));
    doc.moveTo(left, y + h - 1).lineTo(left + width, y + h - 1).strokeColor(LINE).lineWidth(0.3).stroke();
    doc.y = y + h;
  }

  // Repeaters
  if (doc.y + 70 > bottom()) doc.addPage();
  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Repeaters', left, doc.y);
  doc.moveDown(0.3);
  if (!d.repeaterDataAvailable) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No repeater data was imported for this property. Import a CIM report to list repeaters and their check-ins.', left, doc.y, { width });
  } else {
    const rc: [string, number][] = [['Location', 300], ['Repeater ID', 120], ['Last check-in', 130], ['Status', 80]];
    let x = left; const rx = rc.map((c) => { const v = x; x += c[1]; return v; });
    const y = doc.y; doc.rect(left, y - 2, x - left, 14).fill(SHADE); doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5);
    rc.forEach((c, i) => doc.text(c[0], rx[i] + 2, y + 1, { width: c[1] - 4, lineBreak: false }));
    doc.y = y + 15;
    for (const r of d.repeaters) {
      if (doc.y + 14 > bottom()) { doc.addPage(); }
      const yy = doc.y; doc.font('Helvetica').fontSize(8).fillColor(r.online === false ? RED : INK);
      [r.location ?? '', r.hardwareId, r.lastCheckIn ? `${us(r.lastCheckIn)} ${r.lastCheckIn.slice(11, 16)}` : 'Never', r.online === null ? 'Unknown' : r.online ? 'Online' : 'Offline']
        .forEach((c, i) => doc.text(t(c), rx[i] + 2, yy, { width: rc[i][1] - 4, lineBreak: false }));
      doc.y = yy + 13;
    }
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Offline: no check-in within ${OFFLINE_HOURS} hours of the most recent repeater check-in in the report.`, left, doc.y + 4, { width });
  }

  // Footer
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i); doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(t(`${d.property.name}  |  Audit ${periodText(d)}  |  Page ${i + 1} of ${range.count}`), left, doc.page.height - 26, { width, lineBreak: false });
  }
  doc.end();
  return done;
}
