import { Grid, Cell, str, num, bool, parseDate, parseTimestamp, findRow, headerMap, utilityToServiceCode, ParseError } from './common';
import { DEFAULT_SERVICES, type ServiceType } from '../lists/services';
import { preview } from '../importer/index';
import { AMR_STATUS } from '../importer/builtin';
import type { Layout } from '../importer/layout';

/** A row whose utility is not on the service list is reported and left out, never filed as water. */
function serviceOrWarn(utility: string | null, services: ServiceType[], unit: string, warnings: string[]): string | null {
  const code = utilityToServiceCode(utility, services);
  if (!code) warnings.push(`Unit ${unit}: utility "${utility}" is not on the service list (Admin > Service codes), so this row was not imported.`);
  return code;
}

/**
 * Read a flat report with a built-in import map. Rows it cannot read stop the import (code needs_wizard) so the
 * file opens in the import wizard, where each problem row is shown; nothing is filed by guesswork.
 */
export function readWithMap(rows: Grid, layout: Layout, services: ServiceType[]) {
  const p = preview([{ name: layout.name, rows }], layout, {}, { services });
  if (!p.importable || !p.parsed) {
    const why = p.blocking[0] ?? (p.rejected.length ? `${p.rejected.length} row(s) cannot be read (first: row ${p.rejected[0].row}, ${p.rejected[0].reasons[0]})` : 'nothing to import');
    throw new ParseError(`${layout.name}: ${why}.`, 'needs_wizard');
  }
  return p.parsed;
}

export interface CimRepeater { hardwareId: string; location: string | null; lastCheckIn: string | null }

export interface CimUnitDevice {
  building: string;
  unit: string;
  serviceCode: string;
  meterLabel: string | null;       // Meter_Id on the report (vendor label)
  hardwareId: string | null;       // transmitter / transceiver ID
  meterModel: string | null;
  transmitterModel?: string | null;
  batteryLevel?: number | null;     // percent, Next Century AMR Status Report
  lastCheckIn: string | null;
  imr: number | null;
  pulseCount: number | null;
  meterUsage: number | null;
  // Inovonics-only flags
  lowBattery: boolean | null; tamper: boolean | null; jammed: boolean | null;
  powerLoss: boolean | null; reset: boolean | null;
  signalLevel: number | null; signalMargin: number | null;
}

export interface CimParse {
  kind: 'cim_nextcentury' | 'cim_inovonics';
  property: string | null;
  projectId: string | null;
  reportDate: string | null;
  totalEndpoints: number | null;
  reportingIn: number | null;
  nonAdvancing: number | null;
  repeaters: CimRepeater[];
  devices: CimUnitDevice[];
  warnings: string[];
}

const at = (r: Cell[], i: number | undefined): Cell => (i === undefined ? null : (r[i] ?? null));

/** CIM from NextCentury or Zenner Flite: stacked sections (summary, repeaters, per-unit table). */
export function parseCimNextCentury(rows: Grid, services: ServiceType[] = DEFAULT_SERVICES): CimParse {
  const warnings: string[] = [];
  // Summary block: label/value pairs in columns A:B, F:G, I:J of the first rows.
  const kv = new Map<string, Cell>();
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i] ?? [];
    for (const c of [0, 5, 8]) {
      const k = str(r[c])?.toLowerCase().replace(/[:#\s-]+/g, ' ').trim();
      if (k) kv.set(k, r[c + 1] ?? null);
    }
  }
  const header = findRow(rows, (r) => str(r[0])?.toLowerCase() === 'building' && str(r[1])?.toLowerCase() === 'unit');
  if (header < 0) throw new ParseError('CIM per-unit table not found (expected a Building / Unit header row).');
  const repHeader = findRow(rows, (r) => (str(r[0]) ?? '').toLowerCase().startsWith('repeaters'), 0, header);

  const repeaters: CimRepeater[] = [];
  if (repHeader >= 0) {
    // Hard upper bound at the per-unit header so a blank line never lets units spill in.
    for (let i = repHeader + 1; i < header; i++) {
      const id = str(rows[i]?.[0]);
      if (!id) continue;
      repeaters.push({ hardwareId: id, location: null, lastCheckIn: parseTimestamp(rows[i][1]) });
    }
  } else warnings.push('No Repeaters section found.');

  const h = headerMap(rows[header]);
  const devices: CimUnitDevice[] = [];
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const building = str(at(r, h.get('building')));
    const unit = str(at(r, h.get('unit')));
    if (!building && !unit) continue;
    const serviceCode = serviceOrWarn(str(at(r, h.get('utility_type'))), services, `${building ?? ''}-${unit ?? ''}`, warnings);
    if (!serviceCode) continue;
    devices.push({
      building: building ?? '', unit: unit ?? '',
      serviceCode,
      meterLabel: str(at(r, h.get('meter_id'))) ?? str(at(r, h.get('meterid'))),
      hardwareId: str(at(r, h.get('serial_number'))),
      meterModel: str(at(r, h.get('meter_type'))),
      lastCheckIn: parseTimestamp(at(r, h.get('last_check_in'))),
      imr: num(at(r, h.get('imr'))),
      pulseCount: num(at(r, h.get('pulse_count'))),
      meterUsage: num(at(r, h.get('meter_usage'))),
      lowBattery: batteryLow(at(r, h.get('low_battery') ?? h.get('low battery') ?? h.get('battery') ?? h.get('battery_status') ?? h.get('battery status'))),
      tamper: null, jammed: null, powerLoss: null, reset: null, signalLevel: null, signalMargin: null,
    });
  }
  const propertyRaw = str(kv.get('property') ?? null);
  return {
    kind: 'cim_nextcentury',
    property: propertyRaw,
    projectId: str(kv.get('project id') ?? null),
    reportDate: parseDate(kv.get('date') ?? null),
    totalEndpoints: num(kv.get('total endpoints') ?? null),
    reportingIn: num(kv.get('reporting in') ?? null),
    nonAdvancing: num(kv.get('non advancing') ?? null),
    repeaters, devices, warnings,
  };
}

/** A battery column may hold yes/no or a status word ("Low", "OK", "Good"). Missing or unreadable stays unknown. */
export function batteryLow(v: Parameters<typeof bool>[0]): boolean | null {
  const s = str(v)?.toLowerCase();
  if (s && /\blow\b|replace|critical/.test(s)) return true;
  if (s && /^(ok|good|normal|full|high)$/.test(s)) return false;
  return bool(v);
}

/** CIM from Inovonics: a flat Device Status table. No ClassID: the selected property supplies it. */
export function parseCimInovonics(rows: Grid, services: ServiceType[] = DEFAULT_SERVICES): CimParse {
  const hi = findRow(rows, (r) => str(r[0])?.toLowerCase() === 'type' && r.some((c) => str(c)?.toLowerCase() === 'txid'), 0, 20);
  if (hi < 0) throw new ParseError('Inovonics Device Status header not found (expected Type ... TXID).');
  const h = headerMap(rows[hi]);
  const repeaters: CimRepeater[] = [];
  const devices: CimUnitDevice[] = [];
  const warnings: string[] = [];
  let site: string | null = null;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const type = str(at(r, h.get('type')))?.toLowerCase();
    if (!type) continue;
    const tx = str(at(r, h.get('txid')));
    // Prefer the UTC column when present; the site-local text carries a time zone name we map.
    const checkIn = parseTimestamp(at(r, h.get('last check-in (utc)'))) ?? parseTimestamp(at(r, h.get('last check-in (site time zone)')));
    site ??= str(at(r, h.get('site name')));
    if (type === 'repeater') {
      if (tx) repeaters.push({ hardwareId: tx, location: str(at(r, h.get('location'))), lastCheckIn: checkIn });
      continue;
    }
    if (type !== 'transmitter') { warnings.push(`Row ${i + 1}: unknown Type "${type}" skipped.`); continue; }
    const serviceCode = serviceOrWarn(str(at(r, h.get('utility type'))), services, `${str(at(r, h.get('building name'))) ?? ''}-${str(at(r, h.get('unit name'))) ?? ''}`, warnings);
    if (!serviceCode) continue;
    devices.push({
      building: str(at(r, h.get('building name'))) ?? '',
      unit: str(at(r, h.get('unit name'))) ?? '',
      serviceCode,
      meterLabel: null,
      hardwareId: tx,
      meterModel: null,
      lastCheckIn: checkIn,
      imr: null,
      pulseCount: num(at(r, h.get('count'))),
      meterUsage: null,
      lowBattery: bool(at(r, h.get('low battery'))), tamper: bool(at(r, h.get('tamper'))),
      jammed: bool(at(r, h.get('jammed'))), powerLoss: bool(at(r, h.get('loss of line power'))),
      reset: bool(at(r, h.get('reset'))),
      signalLevel: num(at(r, h.get('signal level'))), signalMargin: num(at(r, h.get('signal margin'))),
    });
  }
  return {
    kind: 'cim_inovonics', property: site, projectId: null, reportDate: null,
    totalEndpoints: null, reportingIn: null, nonAdvancing: null,
    repeaters, devices, warnings,
  };
}

/** Next Century AMR Status Report (.csv or .xlsx): one row per transmitter with Battery Level as a percent. No ClassID. */
export function isAmrStatusHeader(r: Cell[] | undefined): boolean {
  const h = headerMap(r ?? []);
  return h.has('serial number') && h.has('last check in') && h.has('building') && h.has('unit');
}
/** Next Century AMR Status Report, read with its built-in import map (the same reading the import wizard shows). */
export function parseAmrStatus(rows: Grid, services: ServiceType[] = DEFAULT_SERVICES): CimParse {
  return readWithMap(rows, AMR_STATUS, services) as CimParse;
}
