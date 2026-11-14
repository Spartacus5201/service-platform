// What goes on the page, independent of how it is drawn. Both the PDF and the HTML preview are built from this,
// so grouping and totals cannot disagree between them.
import { lineTotal, laborTotal, partTotal, type Audience, type FrozenContent, type FrozenLine } from './render';

export interface WorkGroup {
  description: string;
  quantity: number;
  partPrice: number | null; laborPrice: number | null;
  coverage: string;                       // '' | 'Labor under warranty' | 'Warranty (parts and labor)'
  partTotal: number; laborTotal: number; total: number;
  lines: FrozenLine[];
}

export const coverageLabel = (l: Pick<FrozenLine, 'partCovered' | 'laborCovered'>) =>
  (l.partCovered ? 'Warranty (parts and labor)' : l.laborCovered ? 'Labor under warranty' : '');

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Identical work (same wording, prices and coverage) becomes one row with a quantity. Order of first appearance is kept. */
export function groupWork(lines: FrozenLine[]): WorkGroup[] {
  const map = new Map<string, WorkGroup>();
  for (const l of lines.filter((x) => x.include)) {
    const key = JSON.stringify([l.description.trim().toLowerCase(), l.unitPrice, l.laborPrice ?? null, l.laborCovered, l.partCovered]);
    let g = map.get(key);
    if (!g) { g = { description: l.description.trim(), quantity: 0, partPrice: l.unitPrice, laborPrice: l.laborPrice ?? null, coverage: coverageLabel(l), partTotal: 0, laborTotal: 0, total: 0, lines: [] }; map.set(key, g); }
    g.quantity += l.quantity; g.partTotal = r2(g.partTotal + partTotal(l)); g.laborTotal = r2(g.laborTotal + laborTotal(l)); g.total = r2(g.total + lineTotal(l)); g.lines.push(l);
  }
  return [...map.values()];
}

export interface Totals { items: number; shipping: number; total: number }
export function totals(c: Pick<FrozenContent, 'type' | 'shipping' | 'lines'>): Totals {
  const items = r2(c.lines.reduce((s, l) => s + lineTotal(l), 0));
  const shipping = c.type === 'Proposal' ? (c.shipping ?? 0) : 0;
  return { items, shipping, total: r2(items + shipping) };
}

export interface UnitRow { building: string; unit: string; address: string; issue: string; work: string }
/** One row per affected unit, by building then unit, for the appendix and the technician checklist. */
export function unitRows(lines: FrozenLine[]): UnitRow[] {
  return lines.filter((l) => l.include && (l.unit || l.building))
    .map((l) => ({ building: l.building ?? '', unit: l.unit ?? '', address: l.address ?? '', issue: [l.service, l.issueCode].filter(Boolean).join(' - '), work: l.description }))
    .sort((a, b) => a.building.localeCompare(b.building, undefined, { numeric: true }) || a.unit.localeCompare(b.unit, undefined, { numeric: true }));
}

/** Where each standard clause is placed. Keys not listed here print under "Additional terms". */
export const SLOT: Record<string, 'intro' | 'estimate' | 'terms' | 'authorization' | 'acceptance' | 'notice'> = {
  wa_intro: 'intro', wa_estimate: 'estimate', quote_notice: 'terms', quote_expiry: 'terms',
  wa_authorization: 'authorization', proposal_acceptance: 'acceptance', resident_notice: 'notice',
};
export function bySlot(c: FrozenContent, audience: Audience) {
  const out: Record<string, FrozenContent['clauses']> = { intro: [], estimate: [], terms: [], authorization: [], acceptance: [], notice: [], extra: [] };
  for (const k of c.clauses.filter((x) => !x.audience || x.audience === audience)) (out[SLOT[k.key] ?? 'extra']).push(k);
  return out;
}

export const invoicingCode = (number: string) => number.split('-')[0];
export const cityLine = (p: FrozenContent['property']) => [[p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean).join(' ');
