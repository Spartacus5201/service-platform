import { Grid, Cell, str, num, parseDate, isSentinelDate, findRow, headerMap, ParseError } from './common';
import { isManualMeter } from '../rules/audit';

export interface Occupancy {
  moveInOn: string | null;          // null = vacant (01/01/00 sentinel)
  priorMoveOutOn: string | null;    // informational; null = none recorded
  vacant: boolean;
}

export interface AuditRow {
  classId: string;
  building: string;
  unit: string;
  serviceCode: string;
  amrId: string | null;
  vendorLabel: string | null;
  meterTypeId: string | null;
  manufacturerId: string | null;
  isManual: boolean;
  readCount: number | null;         // Manual Audit only
  port: string | null;              // Mport, Manual Audit only
  net: string | null;               // MNetAddr, Manual Audit only
  lastRealOn: string | null;        // MaxRealDate, Manual Audit only
  readDate1: string | null; read1: number | null;
  readDate2: string | null; read2: number | null;
  usage: number | null;
  occDays: number | null;
  auditResult: string;
  serviceAddr: string | null;
  address: string | null;           // serviceAddr without the ClassID prefix and occupancy range
  occupancy: Occupancy | null;
}

export interface AuditParse { kind: 'auto_audit' | 'manual_audit'; classId: string | null; rows: AuditRow[]; warnings: string[] }

const RANGE = /(\d{2}\/\d{2}\/\d{2})-(\d{2}\/\d{2}\/\d{2})\s*$/;

/** ServiceAddr ends in "MM/DD/YY-MM/DD/YY": current move-in, then the prior tenant's move-out. 01/01/00 = empty. */
export function parseOccupancy(serviceAddr: string | null): Occupancy | null {
  const m = serviceAddr ? RANGE.exec(serviceAddr.trim()) : null;
  if (!m) return null;
  const moveInOn = isSentinelDate(m[1]) ? null : parseDate(m[1]);
  const priorMoveOutOn = isSentinelDate(m[2]) ? null : parseDate(m[2]);
  return { moveInOn, priorMoveOutOn, vacant: moveInOn === null };
}

/** "9900001:100 TEST TRAIL DRIVE # 201 10/16/21-09/30/21" -> "100 TEST TRAIL DRIVE # 201". */
export function parseAddress(serviceAddr: string | null): string | null {
  if (!serviceAddr) return null;
  const a = serviceAddr.trim().replace(/^\d+:/, '').replace(RANGE, '').replace(/\s+/g, ' ').trim();
  return a || null;
}

const portText = (c: Cell): string | null => { const n = num(c); return n === null ? null : String(Math.trunc(n)); };

function at(r: Cell[], i: number | undefined): Cell { return i === undefined ? null : (r[i] ?? null); }

function headerRow(rows: Grid): number {
  const i = findRow(rows, (r) => str(r[0])?.toLowerCase() === 'classid', 0, 20);
  if (i < 0) throw new ParseError('No audit header row found (expected a first column named ClassID).');
  return i;
}

function need(h: Map<string, number>, names: string[]): void {
  const missing = names.filter((n) => !h.has(n));
  if (missing.length) throw new ParseError(`Audit report is missing column(s): ${missing.join(', ')}.`);
}

/** Auto Audit: the TranID2 group precedes TranID1, and the Readdate1 header is blank or "Column1". */
export function parseAutoAudit(rows: Grid): AuditParse {
  const hi = headerRow(rows);
  const h = headerMap(rows[hi]);
  need(h, ['classid', 'bldg#', 'unit#', 'serviceid', 'auditresult', 'readdate2', 'serviceaddr']);
  const d1 = h.get('readdate1') ?? h.get('column1') ?? (h.has('amr#1') ? h.get('amr#1')! + 1 : undefined);
  const out: AuditRow[] = [];
  const warnings: string[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const classId = str(at(r, h.get('classid')));
    if (!classId) continue;
    const addr = str(at(r, h.get('serviceaddr')));
    const occ = parseOccupancy(addr);
    if (addr && !occ) warnings.push(`Row ${i + 1}: no occupancy date range in ServiceAddr.`);
    out.push({
      classId,
      building: str(at(r, h.get('bldg#'))) ?? '',
      unit: str(at(r, h.get('unit#'))) ?? '',
      serviceCode: str(at(r, h.get('serviceid'))) ?? '',
      amrId: str(at(r, h.get('amr#1'))) ?? str(at(r, h.get('ubsamr#'))),
      vendorLabel: str(at(r, h.get('tranid1'))) ?? str(at(r, h.get('ubstranid'))),
      meterTypeId: null, manufacturerId: null, isManual: false, readCount: null, lastRealOn: null, port: null, net: null,
      readDate1: parseDate(at(r, d1)), read1: num(at(r, h.get('read1'))),
      readDate2: parseDate(at(r, h.get('readdate2'))), read2: num(at(r, h.get('read2'))),
      usage: num(at(r, h.get('usage'))),
      occDays: num(at(r, h.get('occdays'))),
      auditResult: (str(at(r, h.get('auditresult'))) ?? '').toUpperCase(),
      serviceAddr: addr,
      address: parseAddress(addr),
      occupancy: occ,
    });
  }
  return { kind: 'auto_audit', classId: out[0]?.classId ?? null, rows: out, warnings };
}

/** Manual Audit: generic Column1-4 headers; ReadCount present; MeterTypeID carries the AMR system name. */
export function parseManualAudit(rows: Grid): AuditParse {
  const hi = headerRow(rows);
  const h = headerMap(rows[hi]);
  need(h, ['classid', 'bldgnbr', 'unitnbr', 'serviceid', 'readcount', 'auditresult']);
  const out: AuditRow[] = [];
  const warnings: string[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const classId = str(at(r, h.get('classid')));
    if (!classId) continue;
    const mt = str(at(r, h.get('metertypeid')));
    const mf = str(at(r, h.get('manufacturerid')));
    const addr = str(at(r, h.get('serviceaddr')));
    out.push({
      classId,
      building: str(at(r, h.get('bldgnbr'))) ?? '',
      unit: str(at(r, h.get('unitnbr'))) ?? '',
      serviceCode: str(at(r, h.get('serviceid'))) ?? '',
      amrId: str(at(r, h.get('mdid'))),
      vendorLabel: str(at(r, h.get('miuid'))),
      meterTypeId: mt, manufacturerId: mf, isManual: isManualMeter(mt, mf),
      port: portText(at(r, h.get('mport'))), net: portText(at(r, h.get('mnetaddr'))),
      readCount: num(at(r, h.get('readcount'))), lastRealOn: parseDate(at(r, h.get('maxrealdate'))),
      readDate1: parseDate(at(r, h.get('column1'))), read1: num(at(r, h.get('read1'))),
      readDate2: parseDate(at(r, h.get('column3'))), read2: num(at(r, h.get('read2'))),
      usage: num(at(r, h.get('usage'))),
      occDays: null,
      auditResult: (str(at(r, h.get('auditresult'))) ?? '').toUpperCase(),
      serviceAddr: addr,
      address: parseAddress(addr),
      occupancy: parseOccupancy(addr),     // Manual Audit usually carries none
    });
  }
  return { kind: 'manual_audit', classId: out[0]?.classId ?? null, rows: out, warnings };
}
