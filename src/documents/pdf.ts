// PDF copies of an issued document, drawn directly (no browser needed). Built from layout.ts, so the PDF and the HTML
// preview group work and add totals the same way. The technician copy is built without prices, totals or client-only clauses.
import PDFDocument from 'pdfkit';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Audience, type FrozenContent } from './render';
import { bySlot, cityLine, groupWork, invoicingCode, totals, unitRows, type WorkGroup } from './layout';

export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
// The built-in PDF fonts cover Latin-1 only; anything else becomes "?" rather than garbage.
export const t = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, '?');
export const dateUs = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}` : iso);

const RED = '#c8102e'; const INK = '#1a1a1a'; const MUTED = '#5a5a5a'; const LINE = '#c9c9c9'; const SHADE = '#f1f1f1';

export function asset(name: string): Buffer | null {
  for (const dir of [process.env.ASSETS_DIR ?? '', join(process.cwd(), 'assets')].filter(Boolean)) {
    const p = join(dir, name); if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

const TITLE: Record<FrozenContent['type'], string> = {
  WA: 'Utility Submetering Service Authorization', Proposal: 'Meter Service Work Authorization Proposal', RFM: 'Request for Material',
};

export async function renderPdf(c: FrozenContent, audience: Audience): Promise<Uint8Array> {
  const client = audience === 'client';
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 40, bottom: 64, left: 48, right: 48 }, bufferPages: true,
    info: { Title: `${c.number} ${c.title ?? ''}`.trim(), Author: 'Minol Service Platform' } });
  const chunks: Buffer[] = [];
  doc.on('data', (d: Buffer) => chunks.push(d));
  const done = new Promise<Uint8Array>((res) => doc.on('end', () => res(new Uint8Array(Buffer.concat(chunks)))));

  const left = doc.page.margins.left; const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (h: number) => { if (doc.y + h > bottom()) { doc.addPage(); runningHead(); } };
  const slots = bySlot(c, audience);
  const tot = totals(c);
  const groups = groupWork(c.lines);
  const units = unitRows(c.lines);

  const runningHead = () => {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(t(`${TITLE[c.type]}  |  ${c.number}  |  ${c.property.name}`), left, 30, { width, lineBreak: false });
    doc.y = 48; doc.fillColor(INK);
  };
  const h2 = (s: string) => { ensure(40); doc.moveDown(0.5); doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(t(s), left, doc.y, { width }); doc.moveDown(0.25); };
  const para = (s: string, size = 9) => {
    for (const p of t(s).split('\n').filter(Boolean)) { ensure(doc.heightOfString(p, { width }) + 6); doc.font('Helvetica').fontSize(size).fillColor(INK).text(p, left, doc.y, { width }); doc.moveDown(0.4); }
  };

  // ---- Page 1: banner, title, facts ----
  const banner = asset('minol-header.jpg');
  if (banner) { doc.image(banner, left, 30, { width }); doc.y = 30 + width * (207 / 1758) + 10; } else { doc.font('Helvetica-Bold').fontSize(22).fillColor(RED).text('MINOL', left, 36); }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(t(TITLE[c.type]), left, doc.y + 4, { width });
  if (c.title) doc.font('Helvetica').fontSize(10.5).fillColor(MUTED).text(t(c.title), { width });
  doc.moveDown(0.6);

  const facts = (rows: [string, string | null | undefined][], x: number, w: number, y0: number) => {
    let y = y0;
    for (const [k, v] of rows) {
      if (!v) continue;
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(t(k.toUpperCase()), x, y, { width: w, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK);
      const h = doc.heightOfString(t(v), { width: w });
      doc.text(t(v), x, y + 10, { width: w }); y += 10 + h + 5;
    }
    return y;
  };
  const colW = (width - 24) / 2; const y0 = doc.y;
  const propLines = [c.property.address, cityLine(c.property)].filter(Boolean).join('\n');
  const contact = c.siteContact ? [c.siteContact.name, c.siteContact.phone, c.siteContact.email].filter(Boolean).join('\n') : null;
  let yl: number; let yr: number;
  if (c.type === 'Proposal') {
    yl = facts([['Submitted to', c.addressee]], left, colW, y0);
    yr = facts([['For property', [c.property.name, propLines].filter(Boolean).join('\n')], ['Proposal date', dateUs(c.issuedOn)], ['Proposal #', c.number], ['Project number', invoicingCode(c.number)],
      ['Valid until', c.quoteValidUntil ? dateUs(c.quoteValidUntil) : null]], left + colW + 24, colW, y0);
  } else {
    yl = facts([['Property', c.property.name], ['Address', propLines], [client ? 'Site contact' : 'Site contact (for access)', contact]], left, colW, y0);
    yr = facts([[c.type === 'WA' ? 'Work authorization #' : 'Request #', c.number], ['Issue date', dateUs(c.issuedOn)], client ? ['Valid until', c.quoteValidUntil ? dateUs(c.quoteValidUntil) : null] : ['', null],
      client && c.chargeCode ? ['Charge code', { '20': '20 - Billable', '21': '21 - MSA', '23': '23 - Installation Warranty' }[c.chargeCode] ?? c.chargeCode] : ['', null],
      ['Salesforce case', c.salesforceCase], ['Work order', c.salesforceWorkOrder]], left + colW + 24, colW, y0);
  }
  doc.y = Math.max(yl, yr) + 2;
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.2).strokeColor(RED).stroke(); doc.moveDown(0.8);

  if (!client && (c.property.accessNotes || c.property.schedulingNotes)) {
    h2('Site access and scheduling'); para([c.property.accessNotes, c.property.schedulingNotes].filter(Boolean).join('\n'), 9.5);
  }
  const sn = c.systemNotes;
  if (!client && sn) {
    const sys = [sn.systemBrand, sn.systemId].filter(Boolean).join('  ');
    const util = sn.utilities.map((u) => [u.utility, u.device].filter(Boolean).join(': ')).join('; ');
    if (sys || sn.collectorLocation || sn.milestoneOn || util || sn.techNote || sn.bring.length) {
      h2('System and instructions');
      const y1 = doc.y;
      const a = facts([['System', sys], ['Collector / gateway location', sn.collectorLocation]], left, colW, y1);
      const b = facts([['Utility and meter', util], [sn.milestoneKind ?? 'Date', sn.milestoneOn ? dateUs(sn.milestoneOn) : null]], left + colW + 24, colW, y1);
      doc.y = Math.max(a, b);
      if (sn.techNote) { doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('TECHNICIAN NOTE', left, doc.y, { width }); doc.moveDown(0.15); para(sn.techNote, 9.5); }
      if (sn.bring.length) {
        ensure(30 + sn.bring.length * 14); doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('TECHNICIAN BRINGS', left, doc.y, { width }); doc.moveDown(0.2);
        for (const b2 of sn.bring) doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(t(`${b2.qty}  x  ${b2.device}`), left + 8, doc.y, { width: width - 8 });
        doc.moveDown(0.5);
      }
    }
  }
  if (client) for (const k of [...slots.intro, ...slots.estimate]) para(k.body);

  // ---- Scope table ----
  const table = (cols: { h: string; w: number; a?: 'r' | 'c' }[], rows: string[][], opts: { shadeEvery?: boolean } = {}) => {
    const W = cols.map((x) => x.w * width); const X: number[] = []; let acc = left; for (const w of W) { X.push(acc); acc += w; }
    const pad = 4;
    const row = (cells: string[], head: boolean, i: number) => {
      doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 8.5 : 9);
      const h = Math.max(...cells.map((s, j) => doc.heightOfString(t(s) || ' ', { width: W[j] - pad * 2 }))) + pad * 2;
      if (doc.y + h > bottom()) { doc.addPage(); runningHead(); drawHead(); doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 8.5 : 9); }
      const y = doc.y;
      if (head) doc.save().rect(left, y, width, h).fill(SHADE).restore();
      else if (opts.shadeEvery && i % 2 === 1) doc.save().rect(left, y, width, h).fill('#fafafa').restore();
      doc.moveTo(left, y + h).lineTo(left + width, y + h).lineWidth(0.4).strokeColor(LINE).stroke();
      cells.forEach((s, j) => doc.fillColor(INK).text(t(s), X[j] + pad, y + pad, { width: W[j] - pad * 2, align: cols[j].a === 'r' ? 'right' : cols[j].a === 'c' ? 'center' : 'left' }));
      doc.y = y + h;
    };
    const drawHead = () => row(cols.map((x) => x.h), true, 0);
    drawHead(); rows.forEach((r, i) => row(r, false, i));
  };

  const hasLabor = groups.some((g) => g.laborPrice != null);
  const priceRow = (g: WorkGroup) => [String(g.quantity), g.description + (g.coverage ? `\n${g.coverage}` : ''), g.partPrice === null ? '' : money(g.partPrice),
    ...(hasLabor ? [g.laborPrice === null ? '' : money(g.laborPrice)] : []), money(g.total)];
  if (client) {
    h2(c.type === 'WA' ? 'Estimated scope and cost' : 'Items');
    table([{ h: 'Qty', w: 0.07, a: 'c' }, { h: 'Description', w: hasLabor ? 0.47 : 0.6 }, { h: c.type === 'WA' ? 'Parts per unit' : 'Unit price', w: 0.15, a: 'r' }, ...(hasLabor ? [{ h: 'Labor per unit', w: 0.15, a: 'r' as const }] : []), { h: 'Total', w: 0.16, a: 'r' }],
      groups.map(priceRow));
    ensure(70); doc.moveDown(0.4);
    const sum = (k: string, v: string, bold = false) => { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(INK).text(t(`${k}   ${v}`), left, doc.y, { width, align: 'right' }); };
    if (c.type === 'Proposal' && tot.shipping) { sum('Items', money(tot.items)); sum('Estimated shipping & handling', money(tot.shipping)); }
    sum(c.type === 'WA' ? 'Estimated total' : 'Total', money(tot.total), true);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(c.type === 'WA' ? 'Estimate only. You will be invoiced for the actual work performed. Does not include sales/use tax.' : 'Does not include sales/use tax.', left, doc.y + 2, { width, align: 'right' });
    doc.fillColor(INK);
    if (c.notes) { h2('Notes'); para(c.notes, 9.5); }
    if (c.type === 'Proposal' && c.preparedBy) { doc.moveDown(0.3); doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(t(`Prepared by ${c.preparedBy}`), left, doc.y, { width }); doc.fillColor(INK); }
  } else {
    h2('Work to complete');
    table([{ h: 'Qty', w: 0.08, a: 'c' }, { h: 'Work', w: 0.92 }], groups.map((g) => [String(g.quantity), g.description + (g.coverage ? `  (${g.coverage})` : '')]));
    if (c.notes) { h2('Notes'); para(c.notes, 9.5); }
  }

  for (const k of slots.terms) { h2(k.title); para(k.body, 8.5); }
  for (const k of slots.extra) { h2(k.title); para(k.body, 8.5); }

  // ---- Authorization / acceptance ----
  const sigBlock = (lines: string[]) => {
    ensure(110); doc.moveDown(0.8);
    let y = doc.y;
    for (const label of lines) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(t(label), left, y + 10, { width: 130 });
      doc.moveTo(left + 135, y + 20).lineTo(left + width - 120, y + 20).lineWidth(0.6).strokeColor(INK).stroke();
      if (label.startsWith('Signature')) { doc.text('Date', left + width - 110, y + 10, { width: 30 }); doc.moveTo(left + width - 80, y + 20).lineTo(left + width, y + 20).stroke(); }
      y += 30;
    }
    doc.y = y;
  };
  if (client && c.type === 'WA' && slots.authorization.length) {
    const [intro, ...opts] = t(slots.authorization[0].body).split('\n').filter(Boolean);
    h2(slots.authorization[0].title); para(intro, 9);
    const options = opts.slice(0, 2); const footnote = opts.slice(2);
    for (const o of options) {
      ensure(doc.heightOfString(o, { width: width - 40 }) + 12);
      const y = doc.y; doc.rect(left + 4, y, 11, 11).lineWidth(0.8).strokeColor(INK).stroke();
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(o, left + 28, y, { width: width - 32 }); doc.moveDown(0.5);
    }
    sigBlock(['Signature of responsible party', 'Name and title (printed)']);
    doc.moveDown(0.5); for (const f of footnote) para(f, 8.5);
    para('Please sign, date and email back to ServiceWA@minolusa.com as soon as possible.', 8.5);
  }
  if (client && c.type === 'Proposal' && slots.acceptance.length) {
    for (const k of slots.acceptance) { h2(k.title); para(k.body, 8.5); }
    sigBlock(['Signature', 'Printed name']);
  }

  // ---- Affected units (WA, RFM): client appendix and the technician checklist ----
  if (c.type !== 'Proposal' && units.length) {
    doc.addPage(); runningHead();
    h2(client ? 'Affected buildings and units' : 'Unit checklist');
    if (client) {
      table([{ h: 'Bldg', w: 0.08 }, { h: 'Unit', w: 0.1 }, { h: 'Address', w: 0.3 }, { h: 'Issue', w: 0.12 }, { h: 'Work', w: 0.4 }],
        units.map((u) => [u.building, u.unit, u.address, u.issue, u.work]), { shadeEvery: true });
    } else {
      table([{ h: 'Done', w: 0.07, a: 'c' }, { h: 'Bldg', w: 0.07 }, { h: 'Unit', w: 0.09 }, { h: 'Address', w: 0.24 }, { h: 'Issue', w: 0.1 }, { h: 'Work / notes', w: 0.43 }],
        units.map((u) => ['[   ]', u.building, u.unit, u.address, u.issue, `${u.work}\n\n`]));
    }
  }

  // ---- Resident access notice (WA client copy): property details filled in, the rest handwritten ----
  if (client && c.type === 'WA' && slots.notice.length) {
    doc.addPage(); runningHead();
    doc.font('Helvetica-Bold').fontSize(20).fillColor(RED).text('IMPORTANT', left, 80, { width, align: 'center' });
    doc.fontSize(15).fillColor(INK).text('ACCESS REQUIREMENT NOTICE', { width, align: 'center' }); doc.moveDown(1.2);
    const fill = (k: string, v = '') => {
      const y = doc.y; doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(t(k), left, y, { width: 150 });
      if (v) doc.font('Helvetica-Bold').fillColor(INK).text(t(v), left + 155, y, { width: width - 155 });
      else doc.moveTo(left + 155, y + 11).lineTo(left + width, y + 11).lineWidth(0.5).strokeColor(INK).stroke();
      doc.y = y + 22;
    };
    fill('Property name', c.property.name); fill('Management office phone #', c.siteContact?.phone ?? ''); fill('Delivery date'); fill('Unit address'); fill('Unit #');
    doc.moveDown(0.6); doc.font('Helvetica').fontSize(10).fillColor(INK).text('Dear Resident:', left, doc.y); doc.moveDown(0.5);
    const [a, b, d] = t(slots.notice[0].body).split('\n').filter(Boolean);
    doc.fontSize(10).text(a ?? '', { width }); doc.moveDown(0.5);
    fill('Repairs have been scheduled for'); doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('during the normal Management Office hours of operation.', left + 155, doc.y - 6, { width: width - 155 }); doc.moveDown(1.2);
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(b ?? '', left, doc.y, { width }); doc.moveDown(0.5);
    doc.text(d ?? '', { width }); doc.moveDown(1); doc.text('Sincerely,', { width });
  }

  // ---- Footer on every page ----
  const foot = asset('minol-footer.jpg');
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;            // the footer sits in the bottom margin; without this pdfkit adds a blank page
    const fy = doc.page.height - 50;
    if (foot) doc.image(foot, left, fy, { width });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(t(`${c.number}  |  ${client ? 'Client copy' : 'Technician copy'}  |  Page ${i + 1} of ${range.count}`),
      left, fy + (foot ? 18 : 8), { width, align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
}
