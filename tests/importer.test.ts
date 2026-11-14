import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, type Sheet } from '../src/parsers/common';
import { parseAmrStatus } from '../src/parsers/cim';
import { parseUnitDirectory } from '../src/parsers/unitdirectory';
import { AMR_STATUS, UNIT_DIRECTORY, matchLayouts, preview, convert, serviceCode } from '../src/importer';
import { synthUnits, synthAmrStatus } from '../src/dev/synthetic';

const csv = (text: string, name = 'csv'): Sheet[] => [{ name, rows: parseCsv(text.replace(/^﻿/, '')) }];
const noWarnings = <T extends { warnings: string[] }>(p: T) => ({ ...p, warnings: [] });

// Real files are kept out of git; these run when they are present on this machine.
const realFiles = (want: RegExp) => {
  const dirs = ['corpus', process.env.REAL_DATA_DIR ?? ''].filter((d) => d && existsSync(d));
  const out: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (want.test(f.name)) out.push(p); } };
  dirs.forEach(walk); return out;
};

const UD = `Bldg #,Unit #,Acct #,Name,Address,# Occ,Start Date,End Date,Balance,Alt CustID,Action
0001,000101,1,JANE EXAMPLE,1 A ST APT 101,2,08/11/26,,112.32,x1,Edit
0001,000102,2,VACANT,1 A ST APT 102,null,,,0,x2,Edit
0001,000103,3,PAT EXAMPLE,1 A ST APT 103,1,01/02/25,06/30/26,0,x3,Edit
0001,000104,4,SAM EXAMPLE,1 A ST APT 104,1,13/45/26,,0,x4,Edit
`;

describe('importer: converters', () => {
  it('reads each type or says why not', () => {
    expect(convert('percent', '25%')).toEqual({ ok: true, value: 25 });
    expect(convert('percent', '125%')).toMatchObject({ ok: false });
    expect(convert('date', '08/11/26')).toEqual({ ok: true, value: '2026-08-11' });
    expect(convert('date', 46000)).toEqual({ ok: true, value: '2025-12-09' });
    expect(convert('date', 'soon')).toMatchObject({ ok: false });
    expect(convert('integer', '2.5')).toMatchObject({ ok: false });
    expect(convert('decimal', '1,234.5')).toEqual({ ok: true, value: 1234.5 });
    expect(convert('timestamp', '11/13/26 06:54:17 Central Standard Time')).toEqual({ ok: true, value: '2026-11-13T12:54:17.000Z' });
    expect(convert('text', '  ')).toEqual({ ok: true, value: null });
  });
  it('never guesses a service', () => {
    expect(['All Water', 'Hot Water', 'Gas', 'Electric', 'ws'].map(serviceCode)).toEqual(['WS', 'WS', 'GS', 'EL', 'WS']);
    expect(serviceCode('Irrigation')).toBeNull();
  });
});

describe('importer: built-in layouts match the hand-written parsers', () => {
  it('AMR Status Report (synthetic)', () => {
    const text = synthAmrStatus(synthUnits(2, 6), { '101': 20 }, undefined, ['102']);
    const p = preview(csv(text), AMR_STATUS);
    expect(p.importable).toBe(true);
    expect(noWarnings(p.parsed!)).toEqual(noWarnings(parseAmrStatus(parseCsv(text))));
  });
  it('Unit Directory (synthetic), with the unreadable date reported', () => {
    const p = preview(csv(UD), UNIT_DIRECTORY);
    expect(p.importable).toBe(true);
    expect(noWarnings(p.parsed!)).toEqual(noWarnings(parseUnitDirectory(UD)));
    expect(p.problems).toEqual([expect.objectContaining({ row: 5, field: 'move_in', severity: 'warning' })]);
    expect(p.unused).toEqual(expect.arrayContaining(['Name', 'Acct #', 'Balance']));
    expect(JSON.stringify(p.rows)).not.toContain('EXAMPLE');
  });
  for (const f of realFiles(/AMR[ _]Status[ _]Report.*\.csv$/i)) it(`AMR Status Report (real): ${f.split('/').pop()}`, () => {
    const text = readFileSync(f, 'utf8');
    const p = preview(csv(text), AMR_STATUS);
    expect(p.blocking).toEqual([]); expect(p.rejected).toEqual([]);
    expect(noWarnings(p.parsed!)).toEqual(noWarnings(parseAmrStatus(parseCsv(text.replace(/^﻿/, '')))));
  });
  for (const f of realFiles(/^Unit Directory.*\.csv$|^unit-directory\.csv$/i)) it(`Unit Directory (real): ${f.split('/').slice(-3).join('/')}`, () => {
    const text = readFileSync(f, 'utf8');
    const p = preview(csv(text), UNIT_DIRECTORY);
    expect(p.blocking).toEqual([]); expect(p.rejected).toEqual([]);
    expect(noWarnings(p.parsed!)).toEqual(noWarnings(parseUnitDirectory(text)));
  });
});

describe('importer: matching, drift and overrides', () => {
  const amr = synthAmrStatus(synthUnits(1, 4));
  it('picks the right layout and none for an unknown file', () => {
    expect(matchLayouts(csv(amr))[0]).toMatchObject({ layout: { id: AMR_STATUS.id }, headerRow: 1, score: 1 });
    expect(matchLayouts(csv(UD))[0].layout.id).toBe(UNIT_DIRECTORY.id);
    expect(matchLayouts(csv('Apt,Reading\n1,5\n'))).toEqual([]);
  });
  it('finds a header below a title block', () => {
    const p = preview(csv('Crown Court II\nExported 11/13/26\n' + amr), AMR_STATUS);
    expect(p.headerRow).toBe(3); expect(p.importable).toBe(true);
  });
  it('stops a file whose headers drifted, and a person can remap the column', () => {
    const drifted = amr.replace('Serial Number', 'Radio ID');
    const p = preview(csv(drifted), AMR_STATUS, { headerRow: 1 });
    expect(p.importable).toBe(false);
    expect(p.blocking.join(' ')).toMatch(/Transmitter ID is required/);
    const fixed = preview(csv(drifted), AMR_STATUS, { headerRow: 1, columns: { hardware_id: 4 } });
    expect(fixed.importable).toBe(true);
    expect(fixed.columns.find((c) => c.field === 'hardware_id')).toMatchObject({ column: 4, header: 'Radio ID' });
  });
  it('rejects a row it cannot read, until it is fixed by a lookup or excluded', () => {
    const odd = amr.replace(/All Water/, 'Irrigation');
    const p = preview(csv(odd), AMR_STATUS);
    expect(p.importable).toBe(false);
    expect(p.rejected).toEqual([{ row: 2, reasons: [expect.stringMatching(/Irrigation/)] }]);
    expect(preview(csv(odd), AMR_STATUS, { lookups: { service: { irrigation: 'WS' } } }).importable).toBe(true);
    const ex = preview(csv(odd), AMR_STATUS, { excludeRows: [2] });
    expect(ex.importable).toBe(true); expect(ex.excluded).toEqual([2]); expect(ex.parsed!.devices).toHaveLength(3);
  });
  it('a fixed value fills a field the file does not have', () => {
    const noUtil = amr.split('\n').map((l) => l.split(',').filter((_, i) => i !== 2).join(',')).join('\n');
    const p = preview(csv(noUtil), AMR_STATUS, { constants: { service: 'Gas' } });
    expect(p.importable).toBe(true); expect(p.parsed!.devices.every((d) => d.serviceCode === 'GS')).toBe(true);
  });
  it('refuses one column for two fields, a column off the sheet, and a missing sheet', () => {
    expect(preview(csv(amr), AMR_STATUS, { columns: { meter_label: 2 } }).blocking.join(' ')).toMatch(/more than one field/);
    expect(preview(csv(amr), AMR_STATUS, { columns: { usage: 40 } }).blocking.join(' ')).toMatch(/outside the sheet/);
    expect(preview(csv(amr), AMR_STATUS, { sheet: 'Nope' }).blocking.join(' ')).toMatch(/not in the file/);
  });
  it('reports repeated transmitters without dropping them', () => {
    const lines = amr.trim().split('\n'); const twice = [...lines, lines[1]].join('\n');
    const p = preview(csv(twice), AMR_STATUS);
    expect(p.importable).toBe(true); expect(p.parsed!.devices).toHaveLength(5);
    expect(p.problems).toEqual([expect.objectContaining({ row: 6, message: 'same as row 2' })]);
  });
});
