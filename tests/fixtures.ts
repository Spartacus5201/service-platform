// Synthetic report builders. Invented properties and IDs only; no client data.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { Grid, Sheet } from '../src/parsers/common';

export const CLASS_ID = '9900001';
const pad = (s: string | number, n: number) => String(s).padStart(n, '0');

export interface UnitSpec { bldg: string; unit: string; code?: string; occ?: string; readCount?: number; manual?: boolean }

export const SAMPLE_UNITS: UnitSpec[] = [
  { bldg: '1', unit: '101', code: 'OK', occ: '03/01/22-01/01/00' },
  { bldg: '1', unit: '102', code: 'NT', occ: '05/10/25-02/28/25' },
  { bldg: '1', unit: '103', code: 'NI', occ: '01/01/00-06/30/25' },   // vacant: first date is the sentinel
  { bldg: '1', unit: '104', code: 'HIGH', occ: '09/15/24-01/01/00' },
  { bldg: '2', unit: '201', code: 'LOW', occ: '11/01/25-10/15/25' },
  { bldg: '2', unit: '202', code: 'ZZ', occ: '02/02/23-01/01/00' },
];

/** Auto Audit: TranID2 group before TranID1, blank Readdate1 header, occupancy range at the end of ServiceAddr. */
export function autoAuditGrid(units = SAMPLE_UNITS): Grid {
  const rows: Grid = [['PASTE ZONE']];
  rows.push(['Classid', 'Bldg#', 'Unit#', 'ServiceID', 'UBSTranID', 'UBSAMR#', 'TranID2', 'AMR#2', 'Readdate2', 'Read2', 'Error2', 'TranId1', 'AMR#1', 'Column1', 'Read1', 'Error1', 'Usage', 'OccDays', 'AuditResult', 'ServiceAddr']);
  units.forEach((u, i) => {
    const label = `${u.unit}-W`;
    rows.push([CLASS_ID + '   ', pad(u.bldg, 4) + '      ', pad(u.unit, 6) + '    ', 'WS                  ', label, `AMR${i}`, label, `AMR${i}`,
      '10/01/2026', (1000 + i * 10) + '      ', null, label, `AMR${i}`, '11/01/2026', (1000 + i * 10 + 5) + '      ', null,
      '5         ', '30        ', (u.code ?? 'OK') + '   ', `${CLASS_ID}:1 TEST ROAD APT ${u.unit} ${u.occ ?? '01/01/20-01/01/00'}`]);
  });
  return rows;
}

const MANUAL_HEADER = ['ClassID', 'ProName', 'BldgNbr', 'UnitNbr', 'ServiceAddr', 'ServiceID', 'GroupID', 'MeterTypeID', 'ManufacturerID', 'MeterID', 'MDID', 'MIUID', 'Mport', 'MNetAddr', 'ReadCount', 'MinRealDate', 'MinRealRead', 'MaxRealDate', 'MaxRealRead', 'Column1', 'Read1', 'EstType1', 'Column2', 'Column3', 'Read2', 'EstType2', 'Column4', 'Usage', 'DailyAvg', 'AuditResult'];

export function manualAuditGrid(): Grid {
  const mk = (unit: string, type: string, mfr: string, count: number, code: string): Grid[number] => [
    CLASS_ID, 'TEST PROPERTY', '0001', pad(unit, 6), `1 TEST ROAD APT ${unit}`, 'WS', 'WATER', type, mfr, `${unit}-W1234`, `ID${unit}`, `${unit}-W`, 0, 0,
    count, '10/01/2026', 100, '10/25/2026', 110, '10/01/2026', 100, '1111', 'NO', '11/01/2026', 110, '1111', 'NO', '    10.00', '    0.33', code];
  return [['PASTE ZONE'], MANUAL_HEADER,
    mk('101', 'TW.COM', 'INOV', 32, 'OK'),
    mk('102', 'TW.COM', 'INOV', 4, 'INT'),      // automated, 5 or fewer: Needs Service
    mk('103', 'TW.COM', 'INOV', 12, 'INT'),     // automated, more than 5: fine
    mk('104', 'MANUAL', 'MAN', 0, 'INT'),       // manual, no reads: missed read
    mk('105', 'MANUAL', 'MAN', 2, 'INT'),       // manual, has reads: fine
    mk('106', 'TW.COM', 'MANUAL', 1, 'INT'),    // MANUAL in ManufacturerID
  ];
}

/** NextCentury / Zenner CIM: summary, repeaters, per-unit table. */
export function cimNextGrid(opts: { zenner?: boolean } = {}): Grid {
  const z = opts.zenner;
  const ts = (d: string) => (z ? `${d}T01:23:51` : new Date(`${d}T13:18:05Z`));
  return [
    ['Property:', 'Test Property', null, null, null, 'Total Endpoints:', 3, null, 'Post-Installation Health Report'],
    ['Project ID:', CLASS_ID, null, null, null, '# Reporting In:', 2, null, 'Date:', z ? '08-04-2026' : '8/7/26'],
    ['Check-in %:', 66.7, null, null, null, '# Non-Advancing:', 1],
    [],
    ['Repeaters:', 'Last_Check_In:'],
    ['R0001', z ? '08.04.2026' : new Date('2026-08-07T13:18:05Z')],
    ['R0002', z ? '07.30.2026' : new Date('2026-06-09T18:33:20Z')],
    [],
    ['Building', 'Unit', 'MeterId', 'Serial_Number', 'Utility_Type', 'Meter_Type', 'Device_Type', 'Last_Check_In', 'IMR', 'Pulse_Count', 'Meter_Usage'],
    ['1', '101', '101', 'TX000101', 'Water', 'Test Poly', 'Transceiver', ts('2026-08-04'), 15, 51, 10],
    ['1', '102', '102', 'TX000102', 'Water', 'Test Poly', 'Transceiver', ts('2026-08-03'), null, 50, 20],
    ['2', '201', '201', 'TX000201', 'Water', 'Test Poly', 'Transceiver', null, null, 0, null],
  ];
}

export function cimInovGrid(): Grid {
  return [
    ['PASTE ZONE'],
    ['Type', 'Portfolio Name', 'Site Name', 'Building Name', 'Unit Name', 'Location', 'TXID', 'Utility Type', 'Inactive 24 Hours', 'Last Check-in (Site Time Zone)', 'Low Battery', 'Reset', 'Tamper', 'Rapid Mode', '10+ Counts in Past Hour', 'Loss of Line Power', 'Jammed', 'Count', 'Signal Level', 'Signal Margin', 'Last Check-in (UTC)'],
    ['Repeater', 'Test Co', 'Test Lofts', null, null, 'Repeater 1', 1001, null, 'No', '08/07/26 14:47:59 Central Daylight Time', false, false, false, null, null, false, false, null, 43, 43],
    ['Transmitter', 'Test Co', 'Test Lofts', '1', '202', null, 2001, 'Water-All', 'No', '08/07/26 14:00:12 Central Daylight Time', true, false, false, false, false, null, false, 15566, 5, 5],
    ['Transmitter', 'Test Co', 'Test Lofts', '1', '202', null, 2002, 'Gas', 'No', '12/07/26 09:00:00 Central Standard Time', false, false, true, false, false, null, true, 135905, 14, 14],
  ];
}

/** PSR template layout: header block, equipment rows, then a per-unit pair table. */
export function psrSheets(opts: { onCa?: boolean } = {}): Sheet[] {
  const wide = (cells: Record<number, unknown>): Grid[number] => {
    const r: Grid[number] = Array(15).fill(null);
    for (const [k, v] of Object.entries(cells)) r[Number(k)] = v as never;
    return r;
  };
  const rows: Grid = [
    wide({ 0: 'Project:', 1: 'Test Property', 6: 'Meter Type: ' }),
    wide({ 0: 'Address:', 1: '1 Test Road', 5: 1 }),
    wide({ 5: 2 }), wide({ 5: 3 }),
    wide({ 0: 'Project #/UBS ID:', 1: CLASS_ID, 5: 4 }),
    wide({ 5: 5 }), wide({ 0: 'Connection:', 5: 6 }), wide({ 0: 'System Type:', 5: 7 }), wide({ 0: 'Number of Units:', 1: 3 }),
    wide({}), wide({}), wide({}),
    wide({ 0: 'Equipment Installation Information:' }),
    wide({ 0: 'Equipment', 2: 'Install date', 3: 'Location', 11: 'SERIAL #:' }),
    wide({ 0: 'Collector', 2: new Date('2026-03-02T00:00:00Z'), 3: 'Office', 11: 'COL001' }),
    wide({ 0: 'Repeater 1', 2: new Date('2026-03-03T00:00:00Z'), 3: 'Bldg 1 hall', 11: 'REP001' }),
    wide({ 0: 'Repeater 2' }),                                         // no date: not installed
    wide({ 0: 'Bldg #', 1: 'Unit #', 2: 'Install date', 3: 'Transmitter ID', 4: 'Meter IDs', 5: 'IMC/IMR', 7: 'Meter Type', 9: 'Issues/Comments' }),
    wide({ 0: '1', 1: '101', 2: new Date('2026-03-10T00:00:00Z'), 3: 'TX000101', 4: 'M101', 5: '15', 7: 'Test Poly' }),
    wide({ 0: '1', 1: '102', 2: new Date('2026-03-12T00:00:00Z'), 3: 'TX000102', 4: 'M102', 7: 'Test Poly', 9: 'Tight space' }),
    wide({ 0: '1', 1: '103' }),                                         // no date: not installed
  ];
  const empty: Sheet = { name: opts.onCa ? 'PSR' : 'PSR CA', rows: [[]] };
  return [{ name: opts.onCa ? 'PSR CA' : 'PSR', rows }, empty];
}

export async function toXlsx(sheets: Sheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    s.rows.forEach((r, i) => r.forEach((v, j) => { if (v !== null && v !== undefined) ws.getCell(i + 1, j + 1).value = v as never; }));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Rewrite a workbook the way some system exports do: x: prefixed elements, unnumbered sheet and table parts. */
export async function toPrefixedVariant(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  for (const n of ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) {
    const f = zip.file(n);
    if (!f) continue;
    let xml = await f.async('string');
    xml = xml.replace(new RegExp(`xmlns="${main}"`), `xmlns:x="${main}"`)
      .replace(/<(\/?)(?!\?)([A-Za-z][\w]*)/g, (_m, slash, tag) => `<${slash}x:${tag}`);
    zip.file(n, '﻿' + xml);
  }
  // unnumbered part name
  const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('nodebuffer');
  zip.remove('xl/worksheets/sheet1.xml');
  zip.file('xl/worksheets/sheet.xml', sheet);
  for (const n of ['xl/_rels/workbook.xml.rels', '[Content_Types].xml']) {
    const x = await zip.file(n)!.async('string');
    zip.file(n, x.split('worksheets/sheet1.xml').join('worksheets/sheet.xml'));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}
