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

// ---------- the rule table ----------
// What each audit code means is a table people can edit (Admin > Rules, tested against past audits before saving).
// The built-in table below reproduces the original rules exactly; the database holds only changed rows.

export type RuleAction = Exclude<Recommendation['action'], 'Requested by property'>;
export type RuleOwner = NonNullable<Recommendation['owner']>;
export const RULE_ACTIONS: RuleAction[] = ['No action', 'Needs Service', 'Verify ID', 'Investigate', 'Unrecognized'];
export const RULE_OWNERS: RuleOwner[] = ['property', 'service coordinator'];
export const RULE_COMPONENTS = ['transmitter', 'meter', 'manual_pick', 'none'] as const;
export type RuleComponent = (typeof RULE_COMPONENTS)[number];

/** One side of a rule: what to recommend, for whom, and why (no full stop; it is added). */
export interface RuleOutcome { action: RuleAction; owner: RuleOwner | null; reason: string }
export interface Rule {
  /** The part the work is on; a unit flagged as a combo device is always "both". */
  component: RuleComponent;
  /** 'standard' uses the occupied / vacant outcomes; 'intermittent' counts reads (the INT method, thresholds in settings). */
  method: 'standard' | 'intermittent';
  occupied: RuleOutcome;
  /** Used when the unit is known to be vacant. Unknown occupancy is treated as occupied, so a unit is never silently skipped. */
  vacant: RuleOutcome;
}
export type RuleTable = Record<string, Rule>;

const same = (action: RuleAction, reason: string, owner: RuleOwner | null = null) => ({ occupied: { action, owner, reason }, vacant: { action, owner, reason } });
export const DEFAULT_RULES: RuleTable = {
  OK: { component: 'none', method: 'standard', ...same('No action', 'Reading OK') },
  NI: { component: 'meter', method: 'standard', occupied: { action: 'Needs Service', owner: null, reason: 'No increment on an occupied unit' }, vacant: { action: 'No action', owner: null, reason: 'No increment on a vacant unit' } },
  NT: { component: 'transmitter', method: 'standard', ...same('Needs Service', 'No transmission') },
  IDMM: { component: 'transmitter', method: 'standard', ...same('Verify ID', 'ID mismatch') },
  LOW: { component: 'meter', method: 'standard', occupied: { action: 'Investigate', owner: 'property', reason: 'Low usage on an occupied unit' }, vacant: { action: 'No action', owner: null, reason: 'Low usage on a vacant unit' } },
  HIGH: { component: 'meter', method: 'standard', ...same('Investigate', 'High usage', 'property') },
  NEG: { component: 'none', method: 'standard', ...same('Investigate', 'Negative usage', 'service coordinator') },
  INT: { component: 'transmitter', method: 'intermittent', ...same('Needs Service', 'Intermittent') },
};

/** The part an audit code points at (built-in table unless one is given); manual pick for OTHER; combo -> both. */
export function componentFor(code: string, isCombo = false, rules: RuleTable = DEFAULT_RULES): Component | undefined {
  if (isCombo) return 'both';
  const c = rules[code]?.component;
  if (c && c !== 'none') return c;
  return code === 'OTHER' ? 'manual_pick' : undefined;
}

export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

export function recommend(input: AuditInput, settings: AuditSettings = DEFAULT_SETTINGS, rules: RuleTable = DEFAULT_RULES): Recommendation {
  const code = normalizeCode(input.code);
  const rule = rules[code];
  if (!rule) return { action: 'Unrecognized', reason: `Unrecognized audit code "${code || '(blank)'}". Review manually.` };
  // A rule with no part names none, even on a combo device.
  const component = rule.component === 'none' ? undefined : componentFor(code, input.isCombo, rules);
  if (rule.method === 'intermittent') return recommendInt(input, settings, component);
  const vacant = input.occupied === false;
  const o = vacant ? rule.vacant : rule.occupied;
  // Say so when occupancy decided the outcome but was not known.
  const differs = rule.occupied.action !== rule.vacant.action || rule.occupied.owner !== rule.vacant.owner;
  const note = input.occupied === null && differs ? ' (occupancy unknown, treated as occupied)' : '';
  return {
    action: o.action,
    ...(o.owner ? { owner: o.owner } : {}),
    ...(component && o.action !== 'No action' ? { component } : {}),
    reason: o.reason.replace(/[.\s]+$/, '') + note + '.',
  };
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
