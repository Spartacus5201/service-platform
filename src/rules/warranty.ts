// Warranty rules (spec, 2026-11-05/06). Three layers, all pure functions.
//  - Install warranty: property level, one major-completion date, parts + labor, properties we installed.
//  - Service labor warranty: endpoint level; any completed technician touch starts the clock.
//    Unable to Access and Unable to Complete do not count. RFM has no warranty.
//  - Service part warranty: device level; starts when that device is installed during service.
// Labor is covered when the install warranty OR the endpoint labor clock is active on the visit date.

export type WarrantyStatus = 'Active' | 'Expiring' | 'Expired' | 'Unknown';

export interface WarrantySettings {
  installMonths: number;      // 12
  serviceMonths: number;      // 12
  expiringDays: number;       // 30
}
export const DEFAULT_WARRANTY: WarrantySettings = { installMonths: 12, serviceMonths: 12, expiringDays: 30 };

/** Add months, clamping to the end of a shorter month (Jan 31 + 1 month = Feb 28/29). Dates are ISO yyyy-mm-dd. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

export interface Layer { status: WarrantyStatus; startedOn?: string; endsOn?: string }

/** A layer is Active through its end date inclusive. */
export function layerStatus(startedOn: string | null | undefined, months: number, asOf: string, expiringDays: number): Layer {
  if (!startedOn) return { status: 'Unknown' };
  const endsOn = addMonths(startedOn, months);
  if (asOf > endsOn) return { status: 'Expired', startedOn, endsOn };
  return { status: daysBetween(asOf, endsOn) <= expiringDays ? 'Expiring' : 'Active', startedOn, endsOn };
}

export interface ServiceVisit {
  date: string;                                   // ISO
  outcome: 'completed' | 'unable_to_access' | 'unable_to_complete';
}

/** Only completed visits are touches. Returns the latest touch date on or before asOf. */
export function latestTouch(visits: ServiceVisit[], asOf: string): string | null {
  const dates = visits.filter((v) => v.outcome === 'completed' && v.date <= asOf).map((v) => v.date).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export function installLayer(installedByUs: boolean, completedOn: string | null | undefined, asOf: string, s = DEFAULT_WARRANTY): Layer {
  if (!installedByUs) return { status: 'Unknown' };            // no install warranty where we did not install
  return layerStatus(completedOn, s.installMonths, asOf, s.expiringDays);
}

export function laborLayer(visits: ServiceVisit[], asOf: string, s = DEFAULT_WARRANTY): Layer {
  return layerStatus(latestTouch(visits, asOf), s.serviceMonths, asOf, s.expiringDays);
}

/** Part layer for one device: the clock is the date the device was installed during service. */
export function partLayer(installedOnDuringService: string | null | undefined, asOf: string, s = DEFAULT_WARRANTY): Layer {
  return layerStatus(installedOnDuringService, s.serviceMonths, asOf, s.expiringDays);
}

const covered = (l: Layer) => l.status === 'Active' || l.status === 'Expiring';

export interface CoverageInput {
  installedByUs: boolean;
  installCompletedOn?: string | null;
  endpointVisits: ServiceVisit[];                 // history at this endpoint, before the visit being scoped
  visitDate: string;
  /** Install date during service for the device being replaced, if any. */
  devicePartInstalledOn?: string | null;
  documentType?: 'WA' | 'Proposal' | 'RFM';
}

export interface Coverage {
  laborCovered: boolean;
  partCovered: boolean;
  basis: string[];
  install: Layer; labor: Layer; part: Layer;
}

export function coverage(i: CoverageInput, s = DEFAULT_WARRANTY): Coverage {
  const none = { status: 'Unknown' as const };
  if (i.documentType === 'RFM') {
    return { laborCovered: false, partCovered: false, basis: ['RFM carries no warranty.'], install: none, labor: none, part: none };
  }
  // The visit itself is not a prior touch: look at visits strictly before it.
  const before = i.endpointVisits.filter((v) => v.date < i.visitDate);
  const install = installLayer(i.installedByUs, i.installCompletedOn, i.visitDate, s);
  const labor = laborLayer(before, i.visitDate, s);
  const part = partLayer(i.devicePartInstalledOn, i.visitDate, s);
  const basis: string[] = [];
  if (covered(install)) basis.push(`Install warranty to ${install.endsOn}`);
  if (covered(labor)) basis.push(`Service labor warranty to ${labor.endsOn}`);
  if (covered(part)) basis.push(`Service part warranty to ${part.endsOn}`);
  // Install warranty covers parts and labor on provided materials; service part warranty covers part and labor.
  const partCovered = covered(install) || covered(part);
  const laborCovered = covered(install) || covered(labor) || covered(part);
  return { laborCovered, partCovered, basis, install, labor, part };
}
