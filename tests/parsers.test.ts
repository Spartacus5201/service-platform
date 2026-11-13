import { describe, it, expect } from 'vitest';
import {
  parseDate, parseTimestamp, normLabel, detectFormat, parseSheets, parseFile, readWorkbook, utilityToServiceCode,
} from '../src/parsers';
import { parseAutoAudit, parseManualAudit, parseOccupancy, parseAddress } from '../src/parsers/audit';
import { parseCimNextCentury, parseCimInovonics } from '../src/parsers/cim';
import { parsePsr } from '../src/parsers/psr';
import { autoAuditGrid, manualAuditGrid, cimNextGrid, cimInovGrid, psrSheets, toXlsx, toPrefixedVariant, CLASS_ID } from './fixtures';

describe('common', () => {
  it('parses report dates and the 01/01/00 sentinel', () => {
    expect(parseDate('10/16/21')).toBe('2021-10-16');
    expect(parseDate('08/07/2026')).toBe('2026-08-07');
    expect(parseDate('01/01/00')).toBeNull();
    expect(parseDate('08.04.2026')).toBe('2026-08-04');
    expect(parseDate('30.07.2026')).toBe('2026-07-30');          // DD.MM when the first part exceeds 12
    expect(parseDate('2026-08-04T01:23:51')).toBe('2026-08-04');
    expect(parseDate(new Date('2026-08-07T00:00:00Z'))).toBe('2026-08-07');
    expect(parseDate('')).toBeNull();
  });
  it('parses timestamps in every CIM style', () => {
    expect(parseTimestamp('2026-08-07T08:57:23-04:00')).toBe('2026-08-07T12:57:23.000Z');
    expect(parseTimestamp('2026-08-04T01:23:51')).toBe('2026-08-04T01:23:51.000Z');
    expect(parseTimestamp('08/07/26 14:47:59 Central Daylight Time')).toBe('2026-08-07T19:47:59.000Z');
    expect(parseTimestamp('12/07/26 09:00:00 Central Standard Time')).toBe('2026-12-07T15:00:00.000Z');
    expect(parseTimestamp('08.04.2026')).toBe('2026-08-04T00:00:00.000Z');
  });
  it('normalizes labels', () => {
    expect(normLabel('0001      ')).toBe('1');
    expect(normLabel('000201    ')).toBe('201');
    expect(normLabel('fh')).toBe('FH');
    expect(normLabel('0')).toBe('0');
  });
  it('maps utilities to service codes', () => {
    expect(utilityToServiceCode('Water-All')).toBe('WS');
    expect(utilityToServiceCode('Gas')).toBe('GS');
  });
});

describe('occupancy from ServiceAddr', () => {
  it('first date is move-in, second is prior move-out', () => {
    expect(parseOccupancy('9900001:100 TEST TRAIL DRIVE # 201 10/16/21-09/30/21'))
      .toEqual({ moveInOn: '2021-10-16', priorMoveOutOn: '2021-09-30', vacant: false });
    expect(parseOccupancy('X # 303 04/01/16-01/01/00')).toEqual({ moveInOn: '2016-04-01', priorMoveOutOn: null, vacant: false });
  });
  it('a 01/01/00 move-in is Vacant (the spreadsheet rule)', () => {
    expect(parseOccupancy('X # 9 01/01/00-06/30/25')).toMatchObject({ moveInOn: null, vacant: true });
  });
  it('returns null when there is no range', () => {
    expect(parseOccupancy('520 HAMILTON ST APT 205')).toBeNull();
    expect(parseOccupancy(null)).toBeNull();
  });
});

describe('unit address', () => {
  it('strips the ClassID prefix and the occupancy range', () => {
    expect(parseAddress('9900001:100 TEST TRAIL DRIVE # 201 10/16/21-09/30/21')).toBe('100 TEST TRAIL DRIVE # 201');
    expect(parseAddress('520 HAMILTON ST APT 205                 ')).toBe('520 HAMILTON ST APT 205');
    expect(parseAddress('X # 303 04/01/16-01/01/00')).toBe('X # 303');
    expect(parseAddress(null)).toBeNull();
  });
});

describe('Auto Audit', () => {
  const p = parseAutoAudit(autoAuditGrid());
  it('reads rows by header name despite the odd column order', () => {
    expect(p.rows).toHaveLength(6);
    expect(p.classId).toBe(CLASS_ID);
    expect(p.rows[0]).toMatchObject({ building: '0001', unit: '000101', serviceCode: 'WS', auditResult: 'OK', usage: 5, occDays: 30 });
  });
  it('takes Readdate1 from the blank-header column', () => {
    expect(p.rows[0].readDate1).toBe('2026-11-01');
    expect(p.rows[0].readDate2).toBe('2026-10-01');
    expect(p.rows[0].read1).toBe(1005);
  });
  it('flags vacant units from the first date', () => {
    expect(p.rows.filter((r) => r.occupancy?.vacant).map((r) => r.unit.trim())).toEqual(['000103']);
  });
  it('fails loudly on the wrong report', () => {
    expect(() => parseAutoAudit([['a', 'b']])).toThrow(/header/);
  });
});

describe('Manual Audit', () => {
  const p = parseManualAudit(manualAuditGrid());
  it('detects MANUAL in MeterTypeID or ManufacturerID', () => {
    expect(p.rows.map((r) => r.isManual)).toEqual([false, false, false, true, true, true]);
  });
  it('carries ReadCount and the two read dates from Column1 and Column3', () => {
    expect(p.rows[1]).toMatchObject({ readCount: 4, readDate1: '2026-10-01', readDate2: '2026-11-01', auditResult: 'INT' });
  });
});

describe('CIM NextCentury / Zenner', () => {
  it('parses the stacked sections (NextCentury, Date objects)', () => {
    const p = parseCimNextCentury(cimNextGrid());
    expect(p).toMatchObject({ property: 'Test Property', projectId: CLASS_ID, totalEndpoints: 3, reportingIn: 2, nonAdvancing: 1 });
    expect(p.repeaters.map((r) => r.hardwareId)).toEqual(['R0001', 'R0002']);
    expect(p.devices).toHaveLength(3);
    expect(p.devices[0]).toMatchObject({ building: '1', unit: '101', hardwareId: 'TX000101', serviceCode: 'WS', imr: 15, pulseCount: 51 });
  });
  it('parses Zenner dotted dates and ISO text check-ins', () => {
    const p = parseCimNextCentury(cimNextGrid({ zenner: true }));
    expect(p.reportDate).toBe('2026-08-04');
    expect(p.repeaters[1].lastCheckIn).toBe('2026-07-30T00:00:00.000Z');
    expect(p.devices[0].lastCheckIn).toBe('2026-08-04T01:23:51.000Z');
    expect(p.devices[2].lastCheckIn).toBeNull();
  });
  it('never lets the repeater list spill into per-unit rows', () => {
    const g = cimNextGrid();
    g.splice(7, 1);                                  // remove the blank line before the unit header
    expect(parseCimNextCentury(g).repeaters).toHaveLength(2);
  });
  it('handles 0 repeaters and 20+ repeaters', () => {
    const none = cimNextGrid(); none.splice(5, 2);
    expect(parseCimNextCentury(none).repeaters).toHaveLength(0);
    const many = cimNextGrid();
    many.splice(5, 2, ...Array.from({ length: 24 }, (_, i) => [`R${i}`, new Date('2026-08-07T00:00:00Z')]));
    const p = parseCimNextCentury(many);
    expect(p.repeaters).toHaveLength(24);
    expect(p.devices).toHaveLength(3);
  });
});

describe('CIM Inovonics', () => {
  const p = parseCimInovonics(cimInovGrid());
  it('splits repeaters from transmitters', () => {
    expect(p.repeaters).toHaveLength(1);
    expect(p.repeaters[0]).toMatchObject({ hardwareId: '1001', location: 'Repeater 1' });
    expect(p.devices).toHaveLength(2);
  });
  it('reads health flags, utility and signal', () => {
    expect(p.devices[0]).toMatchObject({ hardwareId: '2001', serviceCode: 'WS', lowBattery: true, tamper: false, pulseCount: 15566, signalLevel: 5 });
    expect(p.devices[1]).toMatchObject({ serviceCode: 'GS', tamper: true, jammed: true });
  });
  it('maps local check-in text to UTC when no UTC column is filled', () => {
    expect(p.devices[0].lastCheckIn).toBe('2026-08-07T19:00:12.000Z');
    expect(p.devices[1].lastCheckIn).toBe('2026-12-07T15:00:00.000Z');
  });
});

describe('PSR', () => {
  it('counts only rows with an install date', () => {
    const p = parsePsr(psrSheets());
    expect(p.equipment.map((e) => e.label)).toEqual(['Collector', 'Repeater 1']);
    expect(p.units.map((u) => u.unit)).toEqual(['101', '102']);
    expect(p.skippedNoDate).toEqual(['Repeater 2', '1-103']);
  });
  it('reads the project header, serials and pairs', () => {
    const p = parsePsr(psrSheets());
    expect(p).toMatchObject({ project: 'Test Property', projectNumber: CLASS_ID, sheet: 'PSR', completedOn: '2026-03-12' });
    expect(p.equipment[0]).toMatchObject({ kind: 'collector', serial: 'COL001', location: 'Office' });
    expect(p.units[1]).toMatchObject({ transmitterId: 'TX000102', meterId: 'M102', issues: 'Tight space' });
  });
  it('uses PSR CA when that is the tab with data', () => {
    expect(parsePsr(psrSheets({ onCa: true })).sheet).toBe('PSR CA');
  });
});

describe('format detection and files', () => {
  it('recognises each format by header signature', () => {
    const s = (name: string, rows: ReturnType<typeof autoAuditGrid>) => [{ name, rows }];
    expect(detectFormat(s('x', autoAuditGrid()))?.kind).toBe('auto_audit');
    expect(detectFormat(s('x', manualAuditGrid()))?.kind).toBe('manual_audit');
    expect(detectFormat(s('x', cimNextGrid()))?.kind).toBe('cim_nextcentury');
    expect(detectFormat(s('x', cimInovGrid()))?.kind).toBe('cim_inovonics');
    expect(detectFormat(psrSheets())?.kind).toBe('psr');
    expect(detectFormat(s('x', [['nothing', 'useful']]))).toBeNull();
  });
  it('round-trips through a real .xlsx file', async () => {
    const buf = await toXlsx([{ name: 'Audit', rows: autoAuditGrid() }]);
    const p = await parseFile(buf);
    expect(p.kind).toBe('auto_audit');
    expect('rows' in p && p.rows).toHaveLength(6);
  });
  it('reads exports with prefixed XML and unnumbered part names', async () => {
    const buf = await toPrefixedVariant(await toXlsx([{ name: 'Audit', rows: autoAuditGrid() }]));
    const sheets = await readWorkbook(buf);
    expect(sheets).toHaveLength(1);
    const p = parseSheets(sheets);
    expect('rows' in p && p.rows).toHaveLength(6);
  });
});
