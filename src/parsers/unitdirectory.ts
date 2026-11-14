// Unit Directory export (CSV): who has lived in each unit since when. Only building, unit and the dates are read.
// Resident name, account number, balance and customer ID are skipped on purpose and never leave this function.
import { parseCsv } from './common';
import { readWithMap } from './cim';
import { UNIT_DIRECTORY } from '../importer/builtin';
import { DEFAULT_SERVICES } from '../lists/services';

export interface UnitDirectoryRow { building: string; unit: string; moveInOn: string | null; priorMoveOutOn: string | null; vacant: boolean }
export interface UnitDirectoryParse { kind: 'unit_directory'; classId: string | null; rows: UnitDirectoryRow[]; warnings: string[] }

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

/** True when the text looks like a Unit Directory export. */
export function isUnitDirectory(text: string): boolean {
  const first = parseCsv(text.replace(/^﻿/, '').slice(0, 2000))[0];
  const h = new Set((first ?? []).map(norm));
  return h.has('bldg') && h.has('unit') && h.has('startdate');
}

/** Unit Directory, read with its built-in import map. Name, account, balance and customer ID columns are never read. */
export function parseUnitDirectory(text: string): UnitDirectoryParse {
  return readWithMap(parseCsv(text.replace(/^\uFEFF/, '')), UNIT_DIRECTORY, DEFAULT_SERVICES) as UnitDirectoryParse;
}
