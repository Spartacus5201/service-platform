import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { matchService, DEFAULT_SERVICES, type ServiceType } from '../lists/services';

export type Cell = string | number | boolean | Date | null;
export type Grid = Cell[][];
export interface Sheet { name: string; rows: Grid }

/** Flatten ExcelJS cell values (formula results, rich text, hyperlinks) to plain values. */
function plain(v: unknown): Cell {
  if (v === undefined || v === null) return null;
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return plain(o.result);
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return plain(o.text);
    if ('error' in o) return null;
  }
  return null;
}

/**
 * Some system exports (OpenXML SDK style) prefix every element, for example <x:workbook>, which
 * ExcelJS cannot read. Rewrite those parts to the default namespace and retry.
 */
async function normalizePrefixedXml(buf: ArrayBuffer | Uint8Array | Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf as Buffer);
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir || !/\.xml$/.test(name) || /^\[Content_Types\]/.test(name)) continue;
    const xml = await zip.file(name)!.async('string');
    // Root element written with a prefix, e.g. <x:workbook xmlns:x="...">.
    const root = /^\s*<([A-Za-z0-9]+):[A-Za-z0-9]+[\s>]/.exec(xml.replace(/^\uFEFF?<\?xml[^>]*\?>/, ''));
    if (!root) continue;
    const p = root[1];
    // Only spreadsheetml and extended-properties parts are read with default-namespace names;
    // core properties (cp:, dc:) must keep their prefixes.
    if (!new RegExp(`xmlns:${p}="http://schemas\\.openxmlformats\\.org/(spreadsheetml/2006/main|officeDocument/2006/extended-properties)"`).test(xml)) continue;
    zip.file(name, xml
      .replace(new RegExp(`xmlns:${p}=`, 'g'), 'xmlns=')
      .replace(new RegExp(`<(/?)${p}:`, 'g'), '<$1'));
  }
  // ExcelJS only finds worksheet parts named sheetN.xml; some exports name the part sheet.xml.
  const rels = zip.file('xl/_rels/workbook.xml.rels');
  const sheetParts = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  if (rels && sheetParts.some((n) => !/sheet\d+\.xml$/.test(n))) {
    let relXml = await rels.async('string');
    let next = 1 + Math.max(0, ...sheetParts.map((n) => Number(/sheet(\d+)\.xml$/.exec(n)?.[1] ?? 0)));
    for (const n of sheetParts.filter((x) => !/sheet\d+\.xml$/.test(x))) {
      const file = n.split('/').pop()!;
      const fresh = `sheet${next++}.xml`;
      zip.file(`xl/worksheets/${fresh}`, await zip.file(n)!.async('nodebuffer'));
      zip.remove(n);
      const sr = zip.file(`xl/worksheets/_rels/${file}.rels`);
      if (sr) { zip.file(`xl/worksheets/_rels/${fresh}.rels`, await sr.async('nodebuffer')); zip.remove(`xl/worksheets/_rels/${file}.rels`); }
      relXml = relXml.split(`worksheets/${file}"`).join(`worksheets/${fresh}"`);
      const ct = zip.file('[Content_Types].xml');
      if (ct) zip.file('[Content_Types].xml', (await ct.async('string')).split(`/xl/worksheets/${file}"`).join(`/xl/worksheets/${fresh}"`));
    }
    zip.file('xl/_rels/workbook.xml.rels', relXml);
  }
  // Table parts are cosmetic for our purposes and ExcelJS also needs tableN.xml names: drop unnumbered ones.
  const oddTables = Object.keys(zip.files).filter((n) => /^xl\/tables\/[^/]+\.xml$/.test(n) && !/table\d+\.xml$/.test(n));
  if (oddTables.length) {
    for (const n of oddTables) zip.remove(n);
    for (const n of Object.keys(zip.files).filter((x) => /^xl\/worksheets\/(_rels\/.*\.rels|[^/]+\.xml)$/.test(x))) {
      const t = await zip.file(n)!.async('string');
      zip.file(n, t
        .replace(/<(\w+:)?tableParts[\s\S]*?<\/(\w+:)?tableParts>/g, '')
        .replace(/<Relationship\b[^>]*relationships\/table"[^>]*\/>/g, ''));
    }
    const ct = zip.file('[Content_Types].xml');
    if (ct) zip.file('[Content_Types].xml', (await ct.async('string')).replace(/<Override\b[^>]*\/xl\/tables\/[^>]*\/>/g, ''));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function readWorkbook(buf: ArrayBuffer | Uint8Array | Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as ArrayBuffer);
  } catch {
    await wb.xlsx.load((await normalizePrefixedXml(buf)) as unknown as ArrayBuffer);
  }
  return wb.worksheets.map((ws) => {
    const rows: Grid = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const r: Cell[] = [];
      for (let c = 1; c <= ws.columnCount; c++) r.push(plain(row.getCell(c).value));
      rows[n - 1] = r;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return { name: ws.name, rows };
  });
}

export function str(v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = (v instanceof Date ? v.toISOString() : String(v)).trim();
  return s === '' ? null : s;
}

export function num(v: Cell | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function bool(v: Cell | undefined): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = str(v)?.toLowerCase();
  if (!s) return null;
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return null;
}

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const fullYear = (yy: number) => (yy < 70 ? 2000 + yy : 1900 + yy);

/** The reports use 01/01/00 as an empty-date sentinel. */
export function isSentinelDate(v: Cell | undefined): boolean {
  const s = str(v);
  return s === '01/01/00' || s === '01/01/1900' || s === '1900-01-01';
}

/**
 * Parse report dates to ISO yyyy-mm-dd. Accepts Date objects, MM/DD/YY, MM/DD/YYYY,
 * MM.DD.YYYY (Zenner; DD.MM when the first part exceeds 12), MM-DD-YYYY, and ISO text.
 * Blank and the 01/01/00 sentinel return null.
 */
export function parseDate(v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return null;
  const s = v.toString().trim();
  if (!s || isSentinelDate(s)) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\b/.exec(s);
  if (m) {
    let a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) [a, b] = [b, a];       // DD.MM.YYYY
    const y = m[3].length === 2 ? fullYear(+m[3]) : +m[3];
    if (a < 1 || a > 12 || b < 1 || b > 31) return null;
    return iso(y, a, b);
  }
  return null;
}

const TZ_OFFSETS: Record<string, number> = {
  'eastern daylight': -4, 'eastern standard': -5, 'central daylight': -5, 'central standard': -6,
  'mountain daylight': -6, 'mountain standard': -7, 'pacific daylight': -7, 'pacific standard': -8,
  'alaska daylight': -8, 'alaska standard': -9, 'hawaii standard': -10, 'hawaii-aleutian standard': -10,
  edt: -4, est: -5, cdt: -5, cst: -6, mdt: -6, mst: -7, pdt: -7, pst: -8, akdt: -8, akst: -9, hst: -10,
  utc: 0, gmt: 0, z: 0, '': 0,
};

/**
 * Parse a check-in timestamp to an ISO UTC string. Handles Date, ISO with or without offset and fractional seconds,
 * and "MM/DD/YY[YY] H:MM[:SS] [AM|PM] [zone]" where zone is a US zone name ("Central Daylight Time"), its
 * abbreviation (CDT) or UTC/GMT. No zone is read as UTC (how the reports have always been read). Anything it
 * cannot read for certain (an unknown zone, hour 13 with PM) returns null, never a guess.
 */
export function parseTimestamp(v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  if (!s) return null;
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(.*)$/i.exec(s);
  if (m) {
    const y = m[3].length === 2 ? fullYear(+m[3]) : +m[3];
    let h = +m[4]; const ampm = m[7]?.toLowerCase().replace(/\./g, '');
    if (ampm) { if (h < 1 || h > 12) return null; if (ampm === 'pm' && h < 12) h += 12; if (ampm === 'am' && h === 12) h = 0; }
    if (h > 23 || +m[5] > 59 || +(m[6] ?? 0) > 59) return null;
    const tz = m[8].toLowerCase().replace(/\s*time$/, '').trim();
    const off = TZ_OFFSETS[tz];
    if (off === undefined) return null;
    const ms = Date.UTC(y, +m[1] - 1, +m[2], h, +m[5], +(m[6] ?? 0)) - off * 3_600_000;
    return new Date(ms).toISOString();
  }
  m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    const off = m[3] ? (m[3] === 'Z' ? 'Z' : m[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : 'Z';
    const d = new Date(m[1] + 'T' + m[2] + off);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (/\d{1,2}:\d{2}/.test(s)) return null;          // has a time we could not read: do not drop it to midnight
  const d = parseDate(s);
  return d ? d + 'T00:00:00.000Z' : null;
}

/** Normalise building and unit labels for matching: trim, uppercase, strip leading zeros. */
export function normLabel(v: Cell | undefined): string {
  const s = (str(v) ?? '').toUpperCase();
  const stripped = s.replace(/^0+(?=.)/, '');
  return stripped;
}

/**
 * A report's utility wording to the ServiceID, from the service list (Admin > Service codes). A blank utility is
 * water. Wording not on the list returns null: the caller reports the row instead of guessing.
 */
export function utilityToServiceCode(utility: string | null, services: ServiceType[] = DEFAULT_SERVICES): string | null {
  if (!utility || !utility.trim()) return 'WS';
  return matchService(utility, services);
}

/** Find the first row (within the first `limit` rows) satisfying `test`. */
export function findRow(rows: Grid, test: (r: Cell[], i: number) => boolean, from = 0, limit = rows.length): number {
  for (let i = from; i < Math.min(rows.length, limit); i++) if (test(rows[i] ?? [], i)) return i;
  return -1;
}

/** Map lowercase header text to its first column index. */
export function headerMap(row: Cell[]): Map<string, number> {
  const m = new Map<string, number>();
  row.forEach((c, i) => {
    const k = str(c)?.toLowerCase();
    if (k && !m.has(k)) m.set(k, i);
  });
  return m;
}

/** A file that could not be read. `code` tells callers what to do without matching the message text. */
export class ParseError extends Error {
  constructor(message: string, readonly code: 'unreadable' | 'not_recognised' | 'needs_wizard' = 'unreadable') { super(message); }
}

/** Minimal CSV reader: quoted fields, doubled quotes, CRLF. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); if (row.some((x) => x.trim())) rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

