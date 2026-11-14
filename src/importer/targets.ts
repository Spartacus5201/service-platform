// What the app can take in, per target: the fields a layout may map and how mapped rows become the
// same parse result the hand-written parsers produce, so everything after import is unchanged.
import type { FieldDef, Target } from './layout';
import type { CimParse, CimUnitDevice } from '../parsers/cim';
import type { UnitDirectoryParse } from '../parsers/unitdirectory';

export type Values = Record<string, string | number | boolean | null>;
export interface TargetDef {
  target: Target; label: string; fields: FieldDef[];
  /** Fields that identify one row; repeats are reported (not removed). Omit when repeats are normal. */
  key?: string[];
  /** A row is empty (skipped) when all of these are blank. */
  emptyWhen: string[];
  build(rows: Values[]): CimParse | UnitDirectoryParse;
}

const s = (v: Values[string]) => (v === null || v === undefined ? null : String(v));
const n = (v: Values[string]) => (typeof v === 'number' ? v : null);

const devices: TargetDef = {
  target: 'devices', label: 'Transmitters and readings',
  fields: [
    { key: 'building', label: 'Building', type: 'label', aliases: ['Bldg', 'Building Number', 'Bldg #', 'Building #'] },
    { key: 'unit', label: 'Unit', type: 'label', required: true, aliases: ['Apt', 'Apartment', 'Unit #', 'Unit Number', 'Suite'] },
    { key: 'service', label: 'Service', type: 'service', required: true, help: 'Water, gas or electric.', aliases: ['Utility', 'Utility Type', 'Service', 'Service Type', 'ServiceID'] },
    { key: 'hardware_id', label: 'Transmitter ID', type: 'text', required: true, aliases: ['Serial Number', 'Serial', 'Transmitter ID', 'TX ID', 'TxID', 'Radio ID', 'Device ID', 'Endpoint ID', 'TranID'] },
    { key: 'meter_label', label: 'Meter label', type: 'text', aliases: ['Meter Id', 'Meter ID', 'Meter Number', 'Meter #'] },
    { key: 'meter_model', label: 'Meter model', type: 'text', aliases: ['Meter Type', 'Meter Model'] },
    { key: 'transmitter_model', label: 'Transmitter model', type: 'text', aliases: ['Model', 'Transmitter Model', 'Radio Model'] },
    { key: 'battery_level', label: 'Battery %', type: 'percent', aliases: ['Battery', 'Battery Level', 'Battery %', 'Battery Level %'] },
    { key: 'last_check_in', label: 'Last check-in', type: 'timestamp', aliases: ['Last Check In', 'Last Check-In', 'Last Heard', 'Last Seen', 'Last Communication'] },
    { key: 'read', label: 'Meter read', type: 'decimal', aliases: ['Meter Read', 'Read', 'Reading', 'Meter Reading', 'Current Read'] },
    { key: 'usage', label: 'Usage', type: 'decimal', aliases: ['Meter Usage', 'Usage', 'Consumption'] },
  ],
  key: ['building', 'unit', 'hardware_id'],
  emptyWhen: ['building', 'unit'],
  build(rows) {
    const list: CimUnitDevice[] = rows.map((r) => ({
      building: s(r.building) ?? '', unit: s(r.unit) ?? '', serviceCode: s(r.service) ?? 'WS',
      meterLabel: s(r.meter_label), hardwareId: s(r.hardware_id), meterModel: s(r.meter_model), transmitterModel: s(r.transmitter_model),
      batteryLevel: n(r.battery_level), lastCheckIn: s(r.last_check_in), imr: n(r.read), pulseCount: null, meterUsage: n(r.usage),
      lowBattery: null, tamper: null, jammed: null, powerLoss: null, reset: null, signalLevel: null, signalMargin: null,
    }));
    return { kind: 'cim_nextcentury', property: null, projectId: null, reportDate: null, totalEndpoints: list.length,
      reportingIn: null, nonAdvancing: null, repeaters: [], devices: list, warnings: list.length ? [] : ['No transmitter rows found.'] };
  },
};

const unitDirectory: TargetDef = {
  target: 'unit_directory', label: 'Unit directory (occupancy)',
  fields: [
    { key: 'building', label: 'Building', type: 'label', aliases: ['Bldg', 'Bldg #', 'Building'] },
    { key: 'unit', label: 'Unit', type: 'label', required: true, aliases: ['Unit', 'Unit #', 'Apt'] },
    { key: 'move_in', label: 'Start (move-in) date', type: 'date', help: 'Blank or unreadable means vacant.', aliases: ['Start Date', 'Move In', 'Move-In Date', 'Move In Date'] },
    { key: 'move_out', label: 'End (move-out) date', type: 'date', aliases: ['End Date', 'Move Out', 'Move-Out Date', 'Move Out Date'] },
    { key: 'occupants', label: 'Number of occupants', type: 'integer', help: '0 means vacant.', aliases: ['# Occ', 'Occupants', 'Occ'] },
  ],
  emptyWhen: ['unit'],
  build(rows) {
    const out = rows.map((r) => {
      const start = s(r.move_in); const end = s(r.move_out);
      const vacant = !start || !!end || r.occupants === 0;
      return { building: s(r.building) ?? '', unit: s(r.unit) ?? '', moveInOn: vacant ? null : start, priorMoveOutOn: end, vacant };
    });
    return { kind: 'unit_directory', classId: null, rows: out, warnings: [] };
  },
};

export const TARGETS: Record<Target, TargetDef> = { devices, unit_directory: unitDirectory };
