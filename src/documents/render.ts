// Clause merging and HTML rendering. No outside dependencies: PDF output is a later step (print this HTML).

import type { SystemNotes } from './systemnotes';
import { bySlot, cityLine, groupWork, totals, unitRows } from './layout';

export type Audience = 'client' | 'tech';

export interface FrozenLine {
  building: string | null; unit: string | null; address: string | null; service: string | null;
  issueCode: string | null; description: string; component: string | null;
  quantity: number; unitPrice: number | null; laborPrice?: number | null; laborCovered: boolean; partCovered: boolean; include: boolean;
}

export interface FrozenContent {
  number: string;
  type: 'WA' | 'Proposal' | 'RFM';
  actsAs: string[] | null;
  title: string | null;
  chargeCode?: string | null;
  version: number;
  issuedOn: string;
  quoteValidUntil: string | null;
  property: { name: string; classId: string; address: string | null; accessNotes: string | null; schedulingNotes: string | null;
    city?: string | null; state?: string | null; zip?: string | null };
  /** WA Notes frozen at issue: system set-up, technician note, and what to bring. Technician copy only. */
  systemNotes?: (SystemNotes & { bring: { qty: number; device: string }[] }) | null;
  /** Primary property contact, frozen at issue. */
  siteContact?: { name: string | null; phone: string | null; email: string | null } | null;
  /** Proposal "Submitted to" lines, notes under the items, shipping & handling, and who prepared it. */
  addressee?: string | null; notes?: string | null; shipping?: number | null; preparedBy?: string | null;
  salesforceCase: string | null;
  salesforceWorkOrder: string | null;
  clauses: { key: string; title: string; body: string; audience?: Audience }[];
  lines: FrozenLine[];
}

/** Replace {{a.b}} with values from ctx. Unknown fields stay visible as [[missing: a.b]] and are returned. */
export function mergeFields(body: string, ctx: Record<string, unknown>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const v = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), ctx);
    if (v === undefined || v === null || v === '') { missing.push(path); return `[[missing: ${path}]]`; }
    return String(v);
  });
  return { text, missing };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Labor part of a line as billed: $0 when labor or the part is under warranty. */
export function laborTotal(l: FrozenLine): number {
  if (!l.include || l.laborPrice == null || l.laborCovered || l.partCovered) return 0;
  return Math.round(l.quantity * l.laborPrice * 100) / 100;
}
/** Part portion as billed: $0 when the part is under warranty. */
export function partTotal(l: FrozenLine): number {
  if (!l.include || l.unitPrice === null || l.partCovered) return 0;
  return Math.round(l.quantity * l.unitPrice * 100) / 100;
}
/** Line total as billed: part plus labor, each zeroed by its warranty. */
export function lineTotal(l: FrozenLine): number {
  return Math.round((partTotal(l) + laborTotal(l)) * 100) / 100;
}

/** Document total as billed: line totals plus a Proposal's shipping & handling. */
export function documentTotal(c: FrozenContent): number {
  return totals(c).total;
}

/**
 * The technician's copy of a document's content: every price, the shipping and client-only clauses removed before
 * any renderer sees it. Both the HTML and the PDF start here, so neither can show a price by mistake.
 */
export function forTechnician(c: FrozenContent): FrozenContent {
  return {
    ...c, shipping: null,
    lines: c.lines.map((l) => ({ ...l, unitPrice: null, laborPrice: null })),
    clauses: c.clauses.filter((x) => x.audience !== 'client'),
  };
}
export const forAudience = (c: FrozenContent, audience: Audience) => (audience === 'tech' ? forTechnician(c) : c);

/**
 * Client audience: prices and totals. Tech audience: the same work with no prices, no totals, and no client-only clauses.
 * Technicians never see pricing: it is removed here, not hidden with CSS.
 */
export function renderDocumentHtml(content: FrozenContent, audience: Audience): string {
  const c = forAudience(content, audience);
  const showPrice = audience === 'client';
  const groups = groupWork(c.lines);
  const slots = bySlot(c, audience);
  const hasLabor = groups.some((g) => g.laborPrice != null);
  const rows = groups.map((g) => `<tr><td class="n">${esc(g.quantity)}</td><td>${esc(g.description)}${g.coverage ? `<div class="cov">${esc(g.coverage)}</div>` : ''}</td>`
    + (showPrice ? `<td class="n">${g.partPrice === null ? '' : esc(money(g.partPrice))}</td>${hasLabor ? `<td class="n">${g.laborPrice === null ? '' : esc(money(g.laborPrice))}</td>` : ''}<td class="n">${esc(money(g.total))}</td>` : '')
    + `</tr>`).join('\n');
  const head = `<tr><th>Qty</th><th>Work</th>${showPrice ? `<th>${c.type === 'WA' ? 'Parts per unit' : 'Unit price'}</th>${hasLabor ? '<th>Labor per unit</th>' : ''}<th>Total</th>` : ''}</tr>`;
  const tot = totals(c);
  const cols = 2 + (showPrice ? 2 + (hasLabor ? 1 : 0) : 0);
  const units = unitRows(c.lines);
  const unitTable = c.type !== 'Proposal' && units.length
    ? `<h2>${showPrice ? 'Affected buildings and units' : 'Unit checklist'}</h2><table><thead><tr>${showPrice ? '' : '<th>Done</th>'}<th>Bldg</th><th>Unit</th><th>Address</th><th>Issue</th><th>Work</th></tr></thead><tbody>${
      units.map((u) => `<tr>${showPrice ? '' : '<td>&#9744;</td>'}<td>${esc(u.building)}</td><td>${esc(u.unit)}</td><td>${esc(u.address)}</td><td>${esc(u.issue)}</td><td>${esc(u.work)}</td></tr>`).join('')}</tbody></table>` : '';
  const clause = (k: { title: string; body: string }) => `<section><h3>${esc(k.title)}</h3><p>${esc(k.body).replace(/\n/g, '<br>')}</p></section>`;
  const label = c.type === 'WA' ? 'Work Authorization' : c.type === 'RFM' ? 'Request for Material' : 'Proposal';
  const prop = [c.property.name, c.property.address, cityLine(c.property)].filter(Boolean).join(' &middot; ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(c.number)} ${esc(c.title ?? '')}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:2rem;color:#111;max-width:56rem}table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{border-bottom:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f1f1f1;font-size:.85em}.n{text-align:right}h1{margin:0}h2{font-size:1.05rem;margin:1.4rem 0 .3rem}.meta{color:#555;margin-bottom:1rem}.cov{color:#666;font-size:.85em}.tot{text-align:right;font-weight:600;font-size:1.1em}.small{color:#666;font-size:.85em;text-align:right}</style></head><body>
<h1>${esc(label)} ${esc(c.number)}</h1>
<div class="meta">${esc(c.title ?? '')} &middot; ${prop} &middot; v${esc(c.version)} issued ${esc(c.issuedOn)}${showPrice && c.quoteValidUntil ? ` &middot; valid until ${esc(c.quoteValidUntil)}` : ''}${showPrice && c.chargeCode ? ` &middot; charge code ${esc(c.chargeCode)}` : ''}${c.salesforceCase ? ` &middot; Case ${esc(c.salesforceCase)}` : ''}${c.salesforceWorkOrder ? ` &middot; Work Order ${esc(c.salesforceWorkOrder)}` : ''}</div>
${showPrice && c.type === 'Proposal' && c.addressee ? `<section><h3>Submitted to</h3><p>${esc(c.addressee).replace(/\n/g, '<br>')}</p></section>` : ''}
${audience === 'tech' && c.systemNotes ? `<section><h3>System and instructions</h3><p>${esc([[c.systemNotes.systemBrand, c.systemNotes.systemId].filter(Boolean).join(' '), c.systemNotes.collectorLocation && `Location: ${c.systemNotes.collectorLocation}`, c.systemNotes.techNote].filter(Boolean).join('\n')).replace(/\n/g, '<br>')}</p>${c.systemNotes.bring.length ? `<p><b>Technician brings</b><br>${c.systemNotes.bring.map((b) => `${esc(b.qty)} &times; ${esc(b.device)}`).join('<br>')}</p>` : ''}</section>` : ''}
${audience === 'tech' && (c.property.accessNotes || c.property.schedulingNotes) ? `<section><h3>Site notes</h3><p>${esc([c.property.accessNotes, c.property.schedulingNotes].filter(Boolean).join('\n')).replace(/\n/g, '<br>')}</p></section>` : ''}
${showPrice ? [...slots.intro, ...slots.estimate].map((k) => `<p>${esc(k.body)}</p>`).join('\n') : ''}
<table><thead>${head}</thead><tbody>
${rows}
</tbody></table>
${showPrice ? `${c.type === 'Proposal' && tot.shipping ? `<div class="n">Estimated shipping &amp; handling ${esc(money(tot.shipping))}</div>` : ''}<div class="tot">${c.type === 'WA' ? 'Estimated total' : 'Total'} ${esc(money(tot.total))}</div><div class="small">Does not include sales/use tax.</div>` : ''}
${c.notes ? `<section><h3>Notes</h3><p>${esc(c.notes).replace(/\n/g, '<br>')}</p></section>` : ''}
${showPrice && c.type === 'Proposal' && c.preparedBy ? `<p class="small" style="text-align:left">Prepared by ${esc(c.preparedBy)}</p>` : ''}
${[...slots.terms, ...slots.extra, ...slots.authorization, ...slots.acceptance].map(clause).join('\n')}
${unitTable}
</body></html>`;
}
