import { Sheet, Grid, str, findRow, headerMap, readWorkbook, parseCsv, ParseError } from './common';
import { parseAutoAudit, parseManualAudit, AuditParse } from './audit';
import { parseCimNextCentury, parseCimInovonics, parseAmrStatus, isAmrStatusHeader, CimParse } from './cim';
import { parsePsr, PsrParse } from './psr';
import { isUnitDirectory, parseUnitDirectory, type UnitDirectoryParse } from './unitdirectory';
import { DEFAULT_SERVICES, type ServiceType } from '../lists/services';

export type ReportKind = 'auto_audit' | 'manual_audit' | 'cim_nextcentury' | 'cim_inovonics' | 'psr';
export type Parsed = AuditParse | CimParse | PsrParse | UnitDirectoryParse;

export interface Detected { kind: ReportKind | 'amr_status'; sheet: Sheet }

const head = (rows: Grid, n = 15) => rows.slice(0, n);

/** Identify a report from its header signature, whichever tab holds it. */
export function detectFormat(sheets: Sheet[]): Detected | null {
  const psr = sheets.find((s) => s.name === 'PSR' || s.name === 'PSR CA');
  if (psr && findRow(psr.rows, (r) => (str(r[0]) ?? '').toLowerCase().startsWith('equipment installation'), 0, 30) >= 0) {
    return { kind: 'psr', sheet: psr };
  }
  for (const sheet of sheets) {
    for (const r of head(sheet.rows)) {
      const keys = new Set(headerMap(r ?? []).keys());
      if (keys.has('classid') && keys.has('readcount') && keys.has('metertypeid')) return { kind: 'manual_audit', sheet };
      if (keys.has('classid') && keys.has('tranid2') && keys.has('readdate2')) return { kind: 'auto_audit', sheet };
      if (keys.has('type') && keys.has('txid')) return { kind: 'cim_inovonics', sheet };
      if (isAmrStatusHeader(r ?? [])) return { kind: 'amr_status', sheet };
    }
    const first = head(sheet.rows, 6);
    const hasProp = first.some((r) => (str(r?.[0]) ?? '').toLowerCase().startsWith('property'));
    const hasBuilding = findRow(sheet.rows, (r) => str(r[0])?.toLowerCase() === 'building' && str(r[1])?.toLowerCase() === 'unit', 0, 40) >= 0;
    if (hasProp && hasBuilding) return { kind: 'cim_nextcentury', sheet };
  }
  return null;
}

export function parseSheets(sheets: Sheet[], services: ServiceType[] = DEFAULT_SERVICES): Parsed {
  const d = detectFormat(sheets);
  if (!d) throw new ParseError('Report format not recognised.', 'not_recognised');
  switch (d.kind) {
    case 'auto_audit': return parseAutoAudit(d.sheet.rows);
    case 'manual_audit': return parseManualAudit(d.sheet.rows);
    case 'cim_nextcentury': return parseCimNextCentury(d.sheet.rows, services);
    case 'cim_inovonics': return parseCimInovonics(d.sheet.rows, services);
    case 'amr_status': return parseAmrStatus(d.sheet.rows, services);
    case 'psr': return parsePsr(sheets);
  }
}

/** Read an uploaded report. `services` is the service list (from the database in the app). */
export async function parseFile(buf: ArrayBuffer | Uint8Array | Buffer, o: { services?: ServiceType[] } = {}): Promise<Parsed> {
  const services = o.services ?? DEFAULT_SERVICES;
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  const isXlsx = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;     // "PK": a zip container
  if (!isXlsx) {
    const text = new TextDecoder('utf-8').decode(bytes);
    if (isUnitDirectory(text)) return parseUnitDirectory(text);
    const grid = parseCsv(text.replace(/^\uFEFF/, ''));
    if (isAmrStatusHeader(grid[0])) return parseAmrStatus(grid, services);
    throw new ParseError('Report format not recognised. Use the .xlsx report, the Unit Directory .csv, or the AMR Status Report .csv.', 'not_recognised');
  }
  return parseSheets(await readWorkbook(buf), services);
}


export type { AuditParse, CimParse, PsrParse, UnitDirectoryParse };
export * from './common';
