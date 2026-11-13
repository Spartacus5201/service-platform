// Deterministic synthetic data for development and demos. Invented names and IDs only.
import type { Grid, Sheet } from '../parsers/common';

export const SYNTH_CLASS_ID = '9900001';
export const SYNTH_NAME = 'Synthetic Gardens';

/** Small seeded PRNG so every run builds the same property. */
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export interface SynthUnit { bldg: string; unit: string; tx: string; code: string; occupancy: string; readCount: number }

export function synthUnits(buildings = 3, perBuilding = 8, seed = 42): SynthUnit[] {
  const rand = rng(seed);
  const codes = ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'NT', 'NI', 'LOW', 'HIGH', 'IDMM', 'NEG'];
  const out: SynthUnit[] = [];
  for (let b = 1; b <= buildings; b++) {
    for (let u = 1; u <= perBuilding; u++) {
      const unit = `${b}${String(u).padStart(2, '0')}`;
      const vacant = rand() < 0.15;
      const mm = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
      const yy = String(18 + Math.floor(rand() * 8)).padStart(2, '0');
      out.push({
        bldg: String(b), unit, tx: `SYN${String(b * 1000 + u).padStart(6, '0')}`,
        code: codes[Math.floor(rand() * codes.length)],
        occupancy: vacant ? `01/01/00-${mm}/15/${yy}` : `${mm}/01/${yy}-01/01/00`,
        readCount: Math.floor(rand() * 33),
      });
    }
  }
  return out;
}

const pad = (v: string | number, n: number) => String(v).padStart(n, '0');

export interface SynthOpts { classId?: string; name?: string; d1?: string; d2?: string; override?: Record<string, { code?: string; tx?: string }>; lowBattery?: string[] }

export function synthAutoAudit(units: SynthUnit[], o: SynthOpts = {}): Grid {
  const rows: Grid = [['PASTE ZONE'], ['Classid', 'Bldg#', 'Unit#', 'ServiceID', 'UBSTranID', 'UBSAMR#', 'TranID2', 'AMR#2', 'Readdate2', 'Read2', 'Error2', 'TranId1', 'AMR#1', 'Column1', 'Read1', 'Error1', 'Usage', 'OccDays', 'AuditResult', 'ServiceAddr']];
  const cid = o.classId ?? SYNTH_CLASS_ID;
  for (const u of units) {
    const ov = o.override?.[u.unit]; const tx = ov?.tx ?? u.tx; const code = ov?.code ?? u.code;
    rows.push([cid, pad(u.bldg, 4), pad(u.unit, 6), 'WS', `${u.unit}-W`, tx, `${u.unit}-W`, tx, o.d1 ?? '10/01/2026', '1000', null, `${u.unit}-W`, tx, o.d2 ?? '11/01/2026', '1010', null, '10', '30', code, `${cid}:1 SYNTHETIC WAY # ${u.unit} ${u.occupancy}`]);
  }
  return rows;
}

export function synthCim(units: SynthUnit[], o: SynthOpts = {}): Grid {
  const rows: Grid = [
    ['Property:', o.name ?? SYNTH_NAME, null, null, null, 'Total Endpoints:', units.length, null, 'Post-Installation Health Report'],
    ['Project ID:', o.classId ?? SYNTH_CLASS_ID, null, null, null, '# Reporting In:', units.length, null, 'Date:', '11/6/26'],
    ['Check-in %:', 100, null, null, null, '# Non-Advancing:', 0], [],
    ['Repeaters:', 'Last_Check_In:'], ['SYNREP01', new Date('2026-11-05T12:00:00Z')], ['SYNREP02', new Date('2026-11-05T12:05:00Z')], [],
    ['Building', 'Unit', 'MeterId', 'Serial_Number', 'Utility_Type', 'Meter_Type', 'Device_Type', 'Last_Check_In', 'IMR', 'Pulse_Count', 'Meter_Usage', ...(o.lowBattery ? ['Battery'] : [])],
  ];
  for (const u of units) rows.push([u.bldg, u.unit, u.unit, u.tx, 'Water', 'Synthetic Poly', 'Transceiver', '2026-11-05T01:00:00', null, 100, 10, ...(o.lowBattery ? [o.lowBattery.includes(u.unit) ? 'Low' : 'OK'] : [])]);
  return rows;
}

export function synthPsr(units: SynthUnit[], o: SynthOpts = {}): Sheet[] {
  const w = (cells: Record<number, unknown>): Grid[number] => { const r: Grid[number] = Array(15).fill(null); for (const [k, v] of Object.entries(cells)) r[Number(k)] = v as never; return r; };
  const rows: Grid = [
    w({ 0: 'Project:', 1: o.name ?? SYNTH_NAME }), w({ 0: 'Address:', 1: '1 Synthetic Way' }), w({}), w({}),
    w({ 0: 'Project #/UBS ID:', 1: o.classId ?? SYNTH_CLASS_ID }), w({}), w({}), w({}), w({}), w({}), w({}), w({}),
    w({ 0: 'Equipment Installation Information:' }),
    w({ 0: 'Equipment', 2: 'Install date', 3: 'Location', 11: 'SERIAL #:' }),
    w({ 0: 'Collector', 2: new Date('2026-03-02T00:00:00Z'), 3: 'Office', 11: 'SYNCOL01' }),
    w({ 0: 'Repeater 1', 2: new Date('2026-03-03T00:00:00Z'), 3: 'Building 1', 11: 'SYNREP01' }),
    w({ 0: 'Repeater 2', 2: new Date('2026-03-03T00:00:00Z'), 3: 'Building 2', 11: 'SYNREP02' }),
    w({ 0: 'Bldg #', 1: 'Unit #', 2: 'Install date', 3: 'Transmitter ID', 4: 'Meter IDs', 5: 'IMC/IMR', 7: 'Meter Type', 9: 'Issues/Comments' }),
  ];
  for (const u of units) rows.push(w({ 0: u.bldg, 1: u.unit, 2: new Date('2026-03-10T00:00:00Z'), 3: u.tx, 7: 'Synthetic Poly' }));
  return [{ name: 'PSR', rows }, { name: 'PSR CA', rows: [[]] }];
}

/** Next Century AMR Status Report (CSV text). levels: unit -> battery percent; default 100. */
export function synthAmrStatus(units: SynthUnit[], levels: Record<string, number> = {}, checkIn = '2026-11-12T08:00:00-05:00', stale: string[] = []): string {
  const head = 'Building,Unit,Utility Type,Serial Number,Meter Id,Model,Battery Level,Last Check In,Meter Type,Meter Read,Meter Usage';
  const rows = units.map((u) => [u.bldg, u.unit, 'All Water', u.tx, u.unit, 'TR201', `${levels[u.unit] ?? 100}%`, stale.includes(u.unit) ? '2026-09-01T08:00:00-04:00' : checkIn, 'Synthetic Poly', '1000', '10'].join(','));
  return [head, ...rows].join('\n') + '\n';
}
