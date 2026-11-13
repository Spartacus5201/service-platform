// Audit recommendation engine. Pure functions; every threshold is a parameter (stored as a setting).

export type Component = 'meter' | 'transmitter' | 'both' | 'manual_pick';

export interface Recommendation {
  /** 'Requested by property' is only ever set by a reviewer: the property reports a problem the data does not show, or wants an inspection or usage accuracy test. */
  action: 'No action' | 'Needs Service' | 'Verify ID' | 'Investigate' | 'Requested by property' | 'Unrecognized';
  owner?: 'property' | 'service coordinator';
  component?: Component;
  reason: string;
}

export interface AuditInput {
  code: string;                      // AuditResult as reported
  /** true occupied, false vacant, null unknown (no occupancy report imported). */
  occupied: boolean | null;
  isManualRead: boolean;
  readCount: number | null;          // Manual Audit only
  lastRealOn?: string | null;        // date of the last real (non-estimated) read, Manual Audit only
  auditEndOn?: string | null;        // second read date of the audit window
  isCombo?: boolean;                 // flagged manually on the device
}

export interface AuditSettings {
  intReadThreshold: number;          // an automated INT with this many reads or fewer is a candidate (default 5)
  intStaleDays: number;              // ...if its last real read was at least this many days before the audit ended (default 3)
}

export const DEFAULT_SETTINGS: AuditSettings = { intReadThreshold: 5, intStaleDays: 3 };

/** NT/INT/IDMM -> transmitter; NI/HIGH/LOW -> meter; OTHER -> manual pick; combo -> both. */
export function componentFor(code: string, isCombo = false): Component | undefined {
  if (isCombo) return 'both';
  switch (code) {
    case 'NT': case 'INT': case 'IDMM': return 'transmitter';
    case 'NI': case 'HIGH': case 'LOW': return 'meter';
    case 'OTHER': return 'manual_pick';
    default: return undefined;
  }
}

export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

export function recommend(input: AuditInput, settings: AuditSettings = DEFAULT_SETTINGS): Recommendation {
  const code = normalizeCode(input.code);
  const component = componentFor(code, input.isCombo);
  // Unknown occupancy is treated as occupied so a unit is never silently skipped.
  const occ = input.occupied !== false;
  const occNote = input.occupied === null ? ' (occupancy unknown, treated as occupied)' : '';

  switch (code) {
    case 'OK':
      return { action: 'No action', reason: 'Reading OK.' };
    case 'NI':
      return occ
        ? { action: 'Needs Service', component, reason: 'No increment on an occupied unit' + occNote + '.' }
        : { action: 'No action', reason: 'No increment on a vacant unit.' };
    case 'NT':
      return { action: 'Needs Service', component, reason: 'No transmission.' };
    case 'IDMM':
      return { action: 'Verify ID', component, reason: 'ID mismatch.' };
    case 'LOW':
      return occ
        ? { action: 'Investigate', owner: 'property', component, reason: 'Low usage on an occupied unit' + occNote + '.' }
        : { action: 'No action', reason: 'Low usage on a vacant unit.' };
    case 'HIGH':
      return { action: 'Investigate', owner: 'property', component, reason: 'High usage.' };
    case 'NEG':
      return { action: 'Investigate', owner: 'service coordinator', reason: 'Negative usage.' };
    case 'INT':
      return recommendInt(input, settings, component);
    default:
      return { action: 'Unrecognized', reason: `Unrecognized audit code "${code || '(blank)'}". Review manually.` };
  }
}

function recommendInt(input: AuditInput, s: AuditSettings, component: Component | undefined): Recommendation {
  if (input.readCount === null || Number.isNaN(input.readCount)) {
    return { action: 'Unrecognized', reason: 'INT needs a ReadCount (Manual Audit). Review manually.' };
  }
  if (input.isManualRead) {
    return input.readCount === 0
      ? { action: 'Needs Service', component: 'manual_pick', reason: 'Manual read: no reads in the window (missed read).' }
      : { action: 'No action', reason: 'Manual read with reads in the window.' };
  }
  if (input.readCount > s.intReadThreshold) return { action: 'No action', reason: `${input.readCount} reads is more than ${s.intReadThreshold}; not treated as a failure.` };
  const days = input.lastRealOn && input.auditEndOn ? daysBetween(input.lastRealOn, input.auditEndOn) : null;
  if (days !== null && days < s.intStaleDays) return { action: 'No action', reason: `Last real read ${days} day${days === 1 ? '' : 's'} before the audit ended; under ${s.intStaleDays}.` };
  const why = days === null ? 'last real read date not in the report' : `no real read for ${days} days before the audit ended`;
  return { action: 'Needs Service', component, reason: `Intermittent: ${input.readCount} read${input.readCount === 1 ? '' : 's'} (${s.intReadThreshold} or fewer), ${why}.` };
}

/** A meter is manual when MeterTypeID or ManufacturerID reads MANUAL. */
export function isManualMeter(meterTypeId?: string | null, manufacturerId?: string | null): boolean {
  return [meterTypeId, manufacturerId].some((v) => (v ?? '').trim().toUpperCase() === 'MANUAL');
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso.slice(0, 10) + 'T00:00:00Z') - Date.parse(fromIso.slice(0, 10) + 'T00:00:00Z')) / 86400000);
}
