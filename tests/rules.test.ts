import { describe, it, expect } from 'vitest';
import { recommend, componentFor, isManualMeter } from '../src/rules/audit';
import { addMonths, layerStatus, latestTouch, coverage } from '../src/rules/warranty';

const base = { occupied: true, isManualRead: false, readCount: null as number | null };

describe('audit cascade', () => {
  it('OK needs nothing', () => expect(recommend({ ...base, code: 'OK' }).action).toBe('No action'));
  it('NI is service when occupied, silent when vacant', () => {
    expect(recommend({ ...base, code: 'NI' }).action).toBe('Needs Service');
    expect(recommend({ ...base, code: 'NI', occupied: false }).action).toBe('No action');
  });
  it('unknown occupancy is treated as occupied and says so', () => {
    const r = recommend({ ...base, code: 'NI', occupied: null });
    expect(r.action).toBe('Needs Service');
    expect(r.reason).toContain('occupancy unknown');
  });
  it('NT, IDMM, HIGH, LOW, NEG', () => {
    expect(recommend({ ...base, code: 'NT' }).action).toBe('Needs Service');
    expect(recommend({ ...base, code: 'IDMM' }).action).toBe('Verify ID');
    expect(recommend({ ...base, code: 'HIGH' })).toMatchObject({ action: 'Investigate', owner: 'property' });
    expect(recommend({ ...base, code: 'LOW', occupied: false }).action).toBe('No action');
    expect(recommend({ ...base, code: 'NEG' })).toMatchObject({ action: 'Investigate', owner: 'service coordinator' });
  });
  it('unrecognized codes are surfaced, not dropped', () => {
    expect(recommend({ ...base, code: 'ZZZ' }).action).toBe('Unrecognized');
    expect(recommend({ ...base, code: '' }).action).toBe('Unrecognized');
  });
  it('codes are trimmed and case-insensitive (report cells are space-padded)', () => {
    expect(recommend({ ...base, code: 'NT   ' }).action).toBe('Needs Service');
    expect(recommend({ ...base, code: 'ok' }).action).toBe('No action');
  });
});

describe('INT rule', () => {
  it('automated: 5 or fewer reads and a stale last real read is Needs Service, like an NT', () => {
    const r = recommend({ ...base, code: 'INT', readCount: 5, lastRealOn: '2026-11-07', auditEndOn: '2026-11-10' });
    expect(r).toMatchObject({ action: 'Needs Service', component: 'transmitter' });
    expect(r.reason).toContain('3 days');
  });
  it('automated: a recent last real read, or more than 5 reads, is fine', () => {
    expect(recommend({ ...base, code: 'INT', readCount: 5, lastRealOn: '2026-11-08', auditEndOn: '2026-11-10' }).action).toBe('No action');
    expect(recommend({ ...base, code: 'INT', readCount: 6, lastRealOn: '2026-10-01', auditEndOn: '2026-11-10' }).action).toBe('No action');
  });
  it('automated: without a last real read date the read count alone decides, and says so', () => {
    const r = recommend({ ...base, code: 'INT', readCount: 4 });
    expect(r.action).toBe('Needs Service'); expect(r.reason).toContain('not in the report');
  });
  it('thresholds are settings', () => {
    const i = { ...base, code: 'INT', readCount: 7, lastRealOn: '2026-11-01', auditEndOn: '2026-11-10' };
    expect(recommend(i, { intReadThreshold: 8, intStaleDays: 3 }).action).toBe('Needs Service');
    expect(recommend(i, { intReadThreshold: 8, intStaleDays: 10 }).action).toBe('No action');
  });
  it('manual: 0 reads is a missed read, any reads is fine', () => {
    expect(recommend({ ...base, code: 'INT', isManualRead: true, readCount: 0 }).action).toBe('Needs Service');
    expect(recommend({ ...base, code: 'INT', isManualRead: true, readCount: 1 }).action).toBe('No action');
  });
  it('missing ReadCount does not fall through silently', () => {
    expect(recommend({ ...base, code: 'INT', readCount: null }).action).toBe('Unrecognized');
  });
});

describe('components', () => {
  it('maps codes to components', () => {
    expect(componentFor('NT')).toBe('transmitter');
    expect(componentFor('INT')).toBe('transmitter');
    expect(componentFor('IDMM')).toBe('transmitter');
    expect(componentFor('NI')).toBe('meter');
    expect(componentFor('HIGH')).toBe('meter');
    expect(componentFor('OTHER')).toBe('manual_pick');
    expect(componentFor('NT', true)).toBe('both');
  });
  it('detects MANUAL in either column', () => {
    expect(isManualMeter('MANUAL', 'X')).toBe(true);
    expect(isManualMeter('TW.COM', ' manual ')).toBe(true);
    expect(isManualMeter('TW.COM', 'INOV')).toBe(false);
  });
});

describe('warranty dates', () => {
  it('adds months with end-of-month clamping', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-11-05', 12)).toBe('2028-11-05');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });
  it('status is Active, Expiring within 30 days, Expired after the end date', () => {
    expect(layerStatus('2026-01-01', 12, '2026-06-01', 30).status).toBe('Active');
    expect(layerStatus('2026-01-01', 12, '2026-12-10', 30).status).toBe('Expiring');
    expect(layerStatus('2026-01-01', 12, '2027-01-01', 30).status).toBe('Expiring'); // last day still covered
    expect(layerStatus('2026-01-01', 12, '2027-01-02', 30).status).toBe('Expired');
    expect(layerStatus(null, 12, '2026-06-01', 30).status).toBe('Unknown');
  });
});

describe('touches', () => {
  const visits = [
    { date: '2026-03-01', outcome: 'completed' as const },
    { date: '2026-09-01', outcome: 'unable_to_access' as const },
    { date: '2026-10-01', outcome: 'unable_to_complete' as const },
  ];
  it('only completed visits start the labor clock', () => {
    expect(latestTouch(visits, '2026-11-06')).toBe('2026-03-01');
  });
  it('a testing-only completed visit counts', () => {
    expect(latestTouch([{ date: '2026-05-05', outcome: 'completed' }], '2026-06-01')).toBe('2026-05-05');
  });
});

describe('coverage', () => {
  it('install warranty covers parts and labor on a property we installed', () => {
    const c = coverage({ installedByUs: true, installCompletedOn: '2026-03-01', endpointVisits: [], visitDate: '2026-11-06' });
    expect(c).toMatchObject({ laborCovered: true, partCovered: true });
  });
  it('no install warranty where we did not install', () => {
    const c = coverage({ installedByUs: false, installCompletedOn: '2026-03-01', endpointVisits: [], visitDate: '2026-11-06' });
    expect(c.laborCovered).toBe(false);
  });
  it('a prior touch gives labor-only coverage, not parts', () => {
    const c = coverage({ installedByUs: false, endpointVisits: [{ date: '2026-08-01', outcome: 'completed' }], visitDate: '2026-11-06' });
    expect(c).toMatchObject({ laborCovered: true, partCovered: false });
  });
  it('a device installed during service covers its part and labor', () => {
    const c = coverage({ installedByUs: false, endpointVisits: [], devicePartInstalledOn: '2026-08-01', visitDate: '2026-11-06' });
    expect(c).toMatchObject({ laborCovered: true, partCovered: true });
  });
  it('the visit being scoped is not its own prior touch', () => {
    const c = coverage({ installedByUs: false, endpointVisits: [{ date: '2026-11-06', outcome: 'completed' }], visitDate: '2026-11-06' });
    expect(c.laborCovered).toBe(false);
  });
  it('an expired touch does not cover', () => {
    const c = coverage({ installedByUs: false, endpointVisits: [{ date: '2025-01-01', outcome: 'completed' }], visitDate: '2026-11-06' });
    expect(c.laborCovered).toBe(false);
  });
  it('RFM has no warranty even on an installed property', () => {
    const c = coverage({ installedByUs: true, installCompletedOn: '2026-03-01', endpointVisits: [], visitDate: '2026-11-06', documentType: 'RFM' });
    expect(c).toMatchObject({ laborCovered: false, partCovered: false });
  });
});
