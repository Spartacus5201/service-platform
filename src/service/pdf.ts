// PDFs for a closed-out visit: the client's service notes, and the internal invoicing sheet for admin.
import PDFDocument from 'pdfkit';
import { asset, t, dateUs, money } from '../documents/pdf';
import { clientText, type Closeout, type InvoiceSheet } from './closeout';
import { RESULT_LABEL } from './phrases';

const RED = '#c8102e'; const INK = '#1a1a1a'; const MUTED = '#5a5a5a'; const LINE = '#c9c9c9'; const SHADE = '#e6e6e6';

export interface PhotoFile { caption: string | null; where: string; mime: string; bytes: Uint8Array }

function start(title: string, layout: 'landscape' | 'portrait') {
  const doc = new PDFDocument({ size: 'LETTER', layout, margins: { top: 36, bottom: 40, left: 36, right: 36 }, bufferPages: true, info: { Title: title, Author: 'Minol Service Platform' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((res) => doc.on('end', () => res(new Uint8Array(Buffer.concat(chunks)))));
  return { doc, done };
}
const footer = (doc: PDFKit.PDFDocument, text: string, left: number, width: number) => {
  const r = doc.bufferedPageRange();
  for (let i = 0; i < r.count; i++) {
    doc.switchToPage(i); doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(t(`${text}  |  Page ${i + 1} of ${r.count}`), left, doc.page.height - 26, { width, lineBreak: false });
  }
};
const cityLine = (p: Closeout['property']) => [[p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean).join(' ');

/** Header block shared by both documents: label/value pairs in two columns. */
function facts(doc: PDFKit.PDFDocument, rows: [string, string][], x: number, y: number, w: number, labelW = 78) {
  let yy = y;
  for (const [k, v] of rows) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text(t(k), x, yy, { width: labelW - 6, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(t(v || '-'), x + labelW, yy, { width: w - labelW, lineBreak: false, ellipsis: true });
    yy += 13;
  }
  return yy;
}

export async function renderNotesPdf(c: Closeout, photos: PhotoFile[] = []): Promise<Uint8Array> {
  const { doc, done } = start(`Service Notes ${c.property.name} ${c.visit.visitedOn}`, 'landscape');
  const left = 36; const width = doc.page.width - 72; const bottom = () => doc.page.height - 40;

  doc.rect(left, 30, width, 20).fill(RED);
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff').text('Minol Service Notes', left, 35, { width, align: 'center' });
  if (c.visit.status !== 'approved') doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text('DRAFT - NOT APPROVED', left + 8, 37, { lineBreak: false });
  doc.y = 58;

  const y0 = 58; const col = width / 3;
  facts(doc, [['Property', c.property.name], ['Address', c.property.address ?? ''], ['City', c.property.city ?? ''], ['State', c.property.state ?? ''], ['Zip Code', c.property.zip ?? '']], left, y0, col);
  facts(doc, [['Date', dateUs(c.visit.visitedOn)], ['Property ID', c.property.classId], ['Charge Code', c.chargeCode], ['Site Contact', c.contact.name ?? ''], ['Site Phone', c.contact.phone ?? ''], ['Site Email', c.contact.email ?? '']], left + col, y0, col);
  const k = c.counts;
  facts(doc, [['NI', String(k.NI)], ['NT', String(k.NT)], ['INT', String(k.INT)], ['HIGH/LOW', String(k.HIGHLOW)], ['Other', String(k.other)], ['Total', String(k.total)]], left + 2 * col, y0, col - 130, 70);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('Technician', left + width - 120, y0, { width: 120, lineBreak: false });
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(t(c.visit.technician ?? ''), left + width - 120, y0 + 12, { width: 120, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('Service Date', left + width - 120, y0 + 34, { width: 120, lineBreak: false });
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(dateUs(c.visit.visitedOn), left + width - 120, y0 + 46, { width: 120, lineBreak: false });
  doc.y = y0 + 88;
  if (c.visit.summary) { doc.font('Helvetica').fontSize(9).fillColor(INK).text(t(c.visit.summary), left, doc.y, { width }); doc.moveDown(0.6); }

  const cols: [string, number][] = [['Bldg', 34], ['Unit', 44], ['Issue', 92], ['Result', 62], ['Start Read', 46], ['End Read', 46], ['New TX ID', 62], ['Equipment Used', 90], ['Comment', 0]];
  cols[cols.length - 1][1] = width - cols.slice(0, -1).reduce((s, x) => s + x[1], 0);
  const xs: number[] = []; cols.reduce((x, cc) => { xs.push(x); return x + cc[1]; }, left);
  const head = () => {
    const y = doc.y; doc.rect(left, y - 2, width, 14).fill(RED); doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
    cols.forEach((cc, i) => doc.text(cc[0], xs[i] + 2, y + 1, { width: cc[1] - 4, lineBreak: false })); doc.y = y + 15;
  };
  head();
  for (const u of c.units) {
    const comment = [clientText(u), u.extraComment].filter((x) => x && x.trim()).join(' ');
    const cells = [u.building, u.unit, u.issue, RESULT_LABEL[u.result], u.startRead ?? '', u.endRead ?? '', u.newTxId ?? '', u.equipment, comment].map((x) => t(x));
    doc.font('Helvetica').fontSize(7.5);
    const h = Math.max(...cells.map((x, i) => doc.heightOfString(x, { width: cols[i][1] - 4 }))) + 4;
    if (doc.y + h > bottom()) { doc.addPage(); head(); }
    const y = doc.y; doc.fillColor(INK);
    cells.forEach((x, i) => doc.text(x, xs[i] + 2, y, { width: cols[i][1] - 4 }));
    doc.moveTo(left, y + h - 1).lineTo(left + width, y + h - 1).strokeColor(LINE).lineWidth(0.3).stroke(); doc.y = y + h;
  }
  if (!c.units.length) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No units on this visit.', left, doc.y);

  if (photos.length) {
    doc.addPage(); doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text('Photos', left, 40); doc.moveDown(0.5);
    const cw = (width - 20) / 2; const ph = 190; let i = 0;
    for (const p of photos) {
      const x = left + (i % 2) * (cw + 20);
      if (i % 2 === 0 && i > 0) { doc.y += ph + 34; }
      if (doc.y + ph + 30 > bottom()) { doc.addPage(); doc.y = 40; i = 0; }
      const y = doc.y;
      try { doc.image(Buffer.from(p.bytes), x, y, { fit: [cw, ph], align: 'center', valign: 'center' }); } catch { doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('(photo could not be drawn)', x, y); }
      doc.font('Helvetica').fontSize(8).fillColor(INK).text(t([p.where, p.caption].filter(Boolean).join(' - ')), x, y + ph + 3, { width: cw, lineBreak: false, ellipsis: true });
      doc.y = y; i++;
    }
  }
  footer(doc, `${c.property.name}  |  Service Notes ${dateUs(c.visit.visitedOn)}`, left, width);
  doc.end(); return done;
}

export async function renderInvoicePdf(s: InvoiceSheet): Promise<Uint8Array> {
  const c = s.closeout;
  const { doc, done } = start(`Service Invoicing ${c.property.name} ${c.visit.visitedOn}`, 'portrait');
  const left = 36; const width = doc.page.width - 72; const bottom = () => doc.page.height - 40;
  const banner = asset('minol-header.jpg');
  if (banner) { doc.image(banner, left, 28, { width: 330 }); doc.y = 28 + 330 * (207 / 1758) + 6; } else doc.y = 36;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(RED).text('INTERNAL USE ONLY', left, doc.y, { width, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text('Minol Service Invoicing', left, doc.y + 2, { width, align: 'center' });
  doc.moveDown(0.6);
  const y0 = doc.y; const col = width / 2;
  facts(doc, [['Property Name', c.property.name], ['Address', c.property.address ?? ''], ['City', c.property.city ?? ''], ['State', c.property.state ?? ''], ['Zip Code', c.property.zip ?? '']], left, y0, col - 10, 88);
  facts(doc, [['Work Auth #', s.workAuthorization ?? ''], ['Property ID', c.property.classId], ['Charge Code', `${c.chargeCode} ${s.chargeLabel}`], ['Site Contact', c.contact.name ?? ''], ['Site Phone', c.contact.phone ?? ''], ['Site Email', c.contact.email ?? '']], left + col, y0, col, 88);
  const sf = [c.visit.salesforceCase && `Case ${c.visit.salesforceCase}`, c.visit.salesforceWorkOrder && `WO ${c.visit.salesforceWorkOrder}`].filter(Boolean).join('  ') || '-';
  facts(doc, [['Service Date', dateUs(c.visit.visitedOn)], ['Invoicing code', c.code], ['Salesforce', sf]], left, y0 + 90, col, 88);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`Combined Total: ${money(s.total)}`, left + col, y0 + 90, { width: col, align: 'right' });
  doc.y = y0 + 90 + 3 * 13 + 10;

  const cols: [string, number][] = [['Line#', 32], ['Description', 0], ['Qty', 30], ['EQ Price', 56], ['Labor', 52], ['Total', 60]];
  cols[1][1] = width - cols.filter((_, i) => i !== 1).reduce((a, x) => a + x[1], 0);
  const xs: number[] = []; cols.reduce((x, cc) => { xs.push(x); return x + cc[1]; }, left);
  const num = new Set([2, 3, 4, 5]);
  const head = () => { const y = doc.y; doc.rect(left, y - 2, width, 14).fill(SHADE); doc.fillColor(INK).font('Helvetica-Bold').fontSize(8);
    cols.forEach((cc, i) => doc.text(cc[0], xs[i] + 2, y + 1, { width: cc[1] - 4, align: num.has(i) ? 'right' : 'left', lineBreak: false })); doc.y = y + 15; };
  head();
  s.groups.forEach((g, gi) => {
    const units = g.lines.map((l) => `${l.building ?? ''}-${l.unit ?? ''}`).join(', ');
    const desc = `${g.description}${g.coverage ? `  [${g.coverage}]` : ''}`;
    doc.font('Helvetica').fontSize(8.5);
    const h = doc.heightOfString(t(desc), { width: cols[1][1] - 4 }) + doc.heightOfString(t(units), { width: cols[1][1] - 4 }) + 8;
    if (doc.y + h > bottom()) { doc.addPage(); head(); }
    const y = doc.y; doc.fillColor(INK);
    const vals = [String(gi + 1), desc, String(g.quantity), g.partPrice === null ? '-' : money(g.partTotal), g.laborPrice === null ? '-' : money(g.laborTotal), money(g.total)];
    vals.forEach((v, i) => doc.font('Helvetica').fontSize(8.5).text(t(v), xs[i] + 2, y, { width: cols[i][1] - 4, align: num.has(i) ? 'right' : 'left' }));
    doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(t(`Units: ${units}`), xs[1] + 2, y + doc.heightOfString(t(desc), { width: cols[1][1] - 4 }) + 1, { width: cols[1][1] - 4 });
    doc.moveTo(left, y + h - 2).lineTo(left + width, y + h - 2).strokeColor(LINE).lineWidth(0.3).stroke(); doc.y = y + h;
  });
  if (!s.groups.length) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Nothing to invoice.', left, doc.y);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`Combined Total: ${money(s.total)}`, left, doc.y, { width, align: 'right' });
  if (s.warnings.length) { doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(8.5).fillColor(RED).text('Check before invoicing', left, doc.y); doc.font('Helvetica').fontSize(8).fillColor(INK);
    for (const w of s.warnings) doc.text(t(`- ${w}`), left, doc.y, { width }); }
  footer(doc, `INTERNAL USE ONLY  |  ${c.property.name}  |  ${dateUs(c.visit.visitedOn)}`, left, width);
  doc.end(); return done;
}

/** After Action Report: before / work / after for every serviced unit, with a summary and the open items. No prices. */
export async function renderAarPdf(a: import('./aar').Aar, asOf: string): Promise<Uint8Array> {
  const { AAR_LABEL } = await import('./aar');
  const title = `After Action Report ${a.property.name}${a.document ? ` ${a.document.number}` : ` ${a.visits[0]?.visitedOn ?? ''}`}`;
  const { doc, done } = start(title, 'landscape');
  const left = 36; const width = doc.page.width - 72; const bottom = () => doc.page.height - 40;
  doc.rect(left, 30, width, 20).fill(RED);
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff').text('After Action Report', left, 35, { width, align: 'center' });
  const y0 = 58; const col = width / 3;
  facts(doc, [['Property', a.property.name], ['Address', a.property.address ?? ''], ['Property ID', a.property.classId]], left, y0, col);
  facts(doc, [['Work Auth #', a.document?.number ?? '-'], ['Visits', a.visits.map((v) => dateUs(v.visitedOn)).join(', ')], ['Technician', [...new Set(a.visits.map((v) => v.technician).filter(Boolean))].join(', ')]], left + col, y0, col);
  facts(doc, [['Report date', dateUs(asOf)], ['Post-audit due', a.postAuditDue ? dateUs(a.postAuditDue) : '-']], left + 2 * col, y0, col, 90);
  doc.y = y0 + 50;
  const s = a.summary;
  const line = `${s.units} unit(s) serviced. Fixed ${s.fixed} · Still failing ${s.still_failing} · New problem ${s.new_problem} · Revisit needed ${s.revisit} · Awaiting audit ${s.awaiting_audit}. Fixed on the first visit: ${s.units ? Math.round((100 * s.firstVisitFixed) / s.units) : 0}%.`;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(t(line), left, doc.y, { width }); doc.moveDown(0.6);

  const cols: [string, number][] = [['Bldg', 34], ['Unit', 46], ['Svc', 30], ['Visit', 54], ['Before', 70], ['Work done', 150], ['New TX ID', 66], ['After', 0], ['Outcome', 76]];
  cols[7][1] = width - cols.reduce((x, c, i) => (i === 7 ? x : x + c[1]), 0);
  const xs: number[] = []; cols.reduce((x, cc) => { xs.push(x); return x + cc[1]; }, left);
  const head = () => { const y = doc.y; doc.rect(left, y - 2, width, 14).fill(RED); doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
    cols.forEach((cc, i) => doc.text(cc[0], xs[i] + 2, y + 1, { width: cc[1] - 4, lineBreak: false })); doc.y = y + 15; };
  head();
  for (const r of a.rows) {
    const cells = [r.building, r.unit, r.service, dateUs(r.visitedOn), `${r.before.code ?? '-'}${r.before.auditEnded ? ` (to ${dateUs(r.before.auditEnded)})` : ''}`, r.work, r.newTxId ?? '', r.after.evidence, AAR_LABEL[r.outcome]].map((x) => t(x));
    doc.font('Helvetica').fontSize(7.5);
    const h = Math.max(...cells.map((x, i) => doc.heightOfString(x, { width: cols[i][1] - 4 }))) + 4;
    if (doc.y + h > bottom()) { doc.addPage(); head(); }
    const y = doc.y;
    cells.forEach((x, i) => doc.font(i === 8 ? 'Helvetica-Bold' : 'Helvetica').fillColor(i === 8 && r.outcome !== 'fixed' ? RED : INK).text(x, xs[i] + 2, y, { width: cols[i][1] - 4 }));
    doc.moveTo(left, y + h - 1).lineTo(left + width, y + h - 1).strokeColor(LINE).lineWidth(0.3).stroke(); doc.y = y + h;
  }
  if (!a.rows.length) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No units were serviced.', left, doc.y);

  const open = a.rows.filter((r) => r.outcome !== 'fixed');
  if (open.length) {
    if (doc.y + 60 > bottom()) doc.addPage();
    doc.moveDown(0.8); doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Open items and next steps', left, doc.y);
    const next: Record<string, string> = { still_failing: 'Schedule a return visit.', new_problem: 'Review the new audit code and schedule service.', revisit: 'Arrange access and reschedule.', awaiting_audit: 'Re-check after the next audit.' };
    doc.font('Helvetica').fontSize(8.5);
    for (const r of open) doc.text(t(`- ${r.building}-${r.unit} ${r.service}: ${AAR_LABEL[r.outcome]}. ${next[r.outcome] ?? ''}`), left, doc.y, { width });
  }
  footer(doc, `${a.property.name}  |  After Action Report  |  ${dateUs(asOf)}`, left, width);
  doc.end(); return done;
}
