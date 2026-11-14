// Document builder: WA, Proposal, RFM. Drafts are editable; issuing freezes a version; edits after that start the next version.
import type { Db } from '../db';
import { replacementFor } from '../equipment/registry';
import { auditLines, needsAction } from '../queries/audit';
import { mergeFields, type FrozenContent, type FrozenLine } from './render';
import { renderPdf } from './pdf';
import { installLayer } from '../rules/warranty';
import { loadSettings } from '../queries/audit';
import { bringList, getPropertyPrices, getSystemNotes } from './systemnotes';

export class DocumentError extends Error {}
export type DocType = 'WA' | 'Proposal' | 'RFM';

type Q = Pick<Db, 'query'>;
const one = async <T>(q: Q, sql: string, p: unknown[] = []) => (await q.query<T>(sql, p)).rows[0] as T | undefined;

const yymmdd = (iso: string) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);

/** Non-billing client codes start with the last two digits of the year: 262000000 / 262000001 in 2026, 272000000 / 272000001 in 2027. */
export const warrantyCode = (isoDate: string) => `${isoDate.slice(2, 4)}2000000`;      // property still under install warranty
export const noContractCode = (isoDate: string) => `${isoDate.slice(2, 4)}2000001`;   // installed by us, out of warranty, no billing contract
export const CHARGE_CODES = { '20': 'Billable', '21': 'MSA (meter service agreement)', '23': 'Installation Warranty' } as const;
export type ChargeCode = keyof typeof CHARGE_CODES;

/** The invoicing code that starts a document number, and the default charge code, for a property on a date. */
export async function invoicingFor(q: Q, propertyId: string, asOf: string): Promise<{ code: string; chargeCode: ChargeCode }> {
  const p = await one<{ class_id: string; installed_by_us: boolean; install_completed_on: string | null; billing_contract: boolean; msa: boolean }>(q,
    `SELECT class_id, installed_by_us, install_completed_on::text, billing_contract, msa FROM property WHERE id=$1`, [propertyId]);
  if (!p) throw new DocumentError('Unknown property.');
  const { warranty } = await loadSettings(q as Db);
  const layer = installLayer(p.installed_by_us, p.install_completed_on, asOf, warranty).status;
  if (layer === 'Active' || layer === 'Expiring') return { code: warrantyCode(asOf), chargeCode: '23' };
  if (!p.billing_contract) return { code: noContractCode(asOf), chargeCode: p.msa ? '21' : '20' };
  return { code: p.class_id, chargeCode: p.msa ? '21' : '20' };
}

/** InvoicingCode-YYMMDD, then -2, -3 for further documents on the same property and day. */
export async function nextDocumentNumber(q: Q, code: string, isoDate: string): Promise<string> {
  const base = `${code}-${yymmdd(isoDate)}`;
  const r = await q.query<{ number: string }>(`SELECT number FROM document WHERE number = $1 OR number LIKE $1 || '-%'`, [base]);
  if (!r.rows.length) return base;
  const used = r.rows.map((x) => (x.number === base ? 1 : Number(x.number.slice(base.length + 1)))).filter((n) => Number.isInteger(n));
  return `${base}-${Math.max(1, ...used) + 1}`;
}

export interface NewDocument {
  propertyId: string;
  type: DocType;
  title?: string;
  createdOn: string;                       // ISO date; drives the number
  createdBy?: string | null;
  chargeCode?: ChargeCode;                 // default: 23 under install warranty, otherwise 20
  actsAs?: ('WA' | 'RFM')[];               // Proposal only
  salesforceCase?: string | null;
  salesforceWorkOrder?: string | null;
  /** Build lines from the audit's Needs Service / Investigate rows. */
  fromAuditBatch?: string;
  /** The job this document belongs to. Default: the job the audit is attached to, else a new job. */
  jobId?: string | null;
}

export interface Created { documentId: string; versionId: string; number: string; lines: number }

/** Standard wording for each audit code on a client document. Other codes fall back to the audit's own reason. */
export const REQUEST_LABEL = 'Inspection / usage accuracy test (requested by property)';
export const WORK_LABEL: Record<string, string> = {
  NT: 'Meter Service - Non-Transmitting', NI: 'Meter Service - No Usage', INT: 'Meter Service - Intermittent Transmission',
  IDMM: 'Meter Service - Verify Device ID', HIGH: 'Usage Investigation - High Usage', LOW: 'Usage Investigation - Low Usage', NEG: 'Usage Investigation - Negative Usage',
};

/** Line wording: by action for reviewer decisions, by audit code for the standard failures, otherwise the audit's own reason. */
export function workLabel(code: string, rec: { action: string; reason: string }): string {
  if (rec.action === 'Requested by property') return REQUEST_LABEL;
  if (rec.action === 'Needs Service') return WORK_LABEL[code] && ['NT', 'NI', 'INT'].includes(code) ? WORK_LABEL[code] : 'Meter Service';
  return WORK_LABEL[code] ?? `${rec.action}: ${rec.reason}`;
}

/** Cheapest current catalog part for a component, as of a date. Null when the catalog has none. */
async function suggestItem(q: Q, component: string | null, asOf: string) {
  if (!component || component === 'manual_pick') return null;
  const comp = component === 'both' ? 'combo' : component;
  return one<{ id: string; name: string; price: string | null }>(q,
    `SELECT id, name, price::text FROM catalog_item WHERE kind='part' AND component=$1 AND active AND (source IS NULL OR suggest_default) AND effective_from <= $2 ORDER BY effective_from DESC, name LIMIT 1`, [comp, asOf]);
}

/** Default labor charge per unit (setting labor_rate, $85 unless changed). */
export async function laborRate(q: Q): Promise<number> {
  const r = await one<{ value: unknown }>(q, `SELECT value FROM setting WHERE key='labor_rate'`);
  const n = Number(r?.value); return Number.isFinite(n) ? n : 85;
}

export async function createDocument(db: Db, input: NewDocument): Promise<Created> {
  if (input.type !== 'Proposal' && input.actsAs) throw new DocumentError('Only a Proposal can act as another document type.');
  const inv = await invoicingFor(db, input.propertyId, input.createdOn);
  let lines = 0;
  let out!: Created;
  await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, inv.code, input.createdOn);
    const { jobForDocument } = await import('../jobs/jobs');
    const jobId = await jobForDocument(tx, { propertyId: input.propertyId, jobId: input.jobId ?? null, batchId: input.fromAuditBatch ?? null,
      title: input.title ?? `${input.type} ${number}`, requestedOn: input.createdOn, salesforceCase: input.salesforceCase ?? null, createdBy: input.createdBy ?? null });
    const doc = (await one<{ id: string }>(tx,
      `INSERT INTO document (type,property_id,number,title,acts_as,salesforce_case,salesforce_work_order,created_by,charge_code,created_on,job_id,source_batch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [input.type, input.propertyId, number, input.title ?? null, input.actsAs ?? null, input.salesforceCase ?? null, input.salesforceWorkOrder ?? null, input.createdBy ?? null, input.chargeCode ?? inv.chargeCode, input.createdOn, jobId, input.fromAuditBatch ?? null]))!.id;
    const ver = (await one<{ id: string }>(tx, `INSERT INTO document_version (document_id,version) VALUES ($1,1) RETURNING id`, [doc]))!.id;

    if (input.fromAuditBatch && input.type !== 'RFM') {
      const rate = await laborRate(tx);
      const propPrices = await getPropertyPrices(tx, input.propertyId);
      const laborDefault = propPrices.Labor ?? rate;
      const todo = needsAction(await auditLines(tx as unknown as Db, input.fromAuditBatch, input.createdOn));
      const { pmSettings, batteryFor, forWa, PM_DESCRIPTION } = await import('../service/battery');
      const pm = await pmSettings(tx);
      for (const l of todo) {
        // Only Needs Service implies a part; Investigate and Verify ID stay unpriced until the office decides.
        const item = l.recommendation.action === 'Needs Service' ? await suggestItem(tx, l.recommendation.component ?? null, input.createdOn) : null;
        const labor = l.recommendation.action === 'Needs Service' ? laborDefault : null;
        const own = l.recommendation.action === 'Needs Service' ? (l.recommendation.component === 'transmitter' ? propPrices.Transmitter : l.recommendation.component === 'meter' ? propPrices.Meter : undefined) : undefined;
        let part = own ?? (item?.price ?? null); let itemId = item?.id ?? null; let component: string | null = l.recommendation.component ?? null;
        // A transmitter that stopped with a flat battery needs a battery, not a new transmitter.
        if (l.recommendation.action === 'Needs Service' && component === 'transmitter' && forWa(l.lowBattery, pm)) {
          const bat = await batteryFor(tx, l.lowBattery!.model, input.createdOn, pm);
          part = bat.price; itemId = bat.itemId; component = 'battery';
        }
        let label = workLabel(l.code, l.recommendation);
        // The equipment registry knows the installed model: quote its replacement part (or its successor's, when obsolete).
        if (l.recommendation.action === 'Needs Service' && (component === 'transmitter' || component === 'meter')) {
          const rep = await replacementFor(tx, l.endpointId, component, input.createdOn);
          if (rep?.part) { itemId = rep.part.id; if (own === undefined && rep.part.price !== null) part = rep.part.price; }
          if (rep?.note) label = `${label} (${rep.note})`;
        }
        await tx.query(
          `INSERT INTO document_line (version_id,endpoint_id,audit_reading_id,issue_code,description,catalog_item_id,quantity,unit_price,labor_price,labor_covered,part_covered,component,include)
           VALUES ($1,$2,$3,$4,$5,$6,1,$7,$12,$8,$9,$10,$11)`,
          [ver, l.endpointId, l.readingId, l.code, label, itemId, part,
           l.coverage.laborCovered, l.coverage.partCovered, component, l.recommendation.action !== 'Unrecognized', labor]);
        lines++;
      }
      // Preventative maintenance: transmitters still reading with a battery at or below the WA level get their own line group.
      const todoIds = new Set(todo.map((l) => l.endpointId));
      const pmLines = (await auditLines(tx as unknown as Db, input.fromAuditBatch, input.createdOn)).filter((l) => forWa(l.lowBattery, pm) && !todoIds.has(l.endpointId));
      for (const l of pmLines) {
        const bat = await batteryFor(tx, l.lowBattery!.model, input.createdOn, pm);
        const covered = pm.warranty === 'never' ? { labor: false, part: false } : { labor: l.coverage.laborCovered, part: l.coverage.partCovered };
        await tx.query(
          `INSERT INTO document_line (version_id,endpoint_id,audit_reading_id,issue_code,description,catalog_item_id,quantity,unit_price,labor_price,labor_covered,part_covered,component,include)
           VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,'battery',true)`,
          [ver, l.endpointId, l.readingId, pm.code, PM_DESCRIPTION, bat.itemId, bat.price, laborDefault, covered.labor, covered.part]);
        lines++;
      }
    }
    out = { documentId: doc, versionId: ver, number, lines };
  });
  return out;
}

export interface LineInput {
  endpointId?: string | null; issueCode?: string | null; description: string; catalogItemId?: string | null;
  quantity?: number; unitPrice?: number | null; laborPrice?: number | null; laborCovered?: boolean; partCovered?: boolean; component?: string | null; include?: boolean;
}

async function draftGuard(q: Q, versionId: string) {
  const v = await one<{ status: string }>(q, `SELECT status FROM document_version WHERE id=$1`, [versionId]);
  if (!v) throw new DocumentError('Unknown version.');
  if (v.status !== 'draft') throw new DocumentError('This version is issued and locked. Start a new version to edit.');
}

export async function addLine(db: Db, versionId: string, l: LineInput): Promise<string> {
  await draftGuard(db, versionId);
  let price = l.unitPrice ?? null;
  if (price === null && l.catalogItemId) {
    const p = (await one<{ price: string | null }>(db, `SELECT price::text FROM catalog_item WHERE id=$1`, [l.catalogItemId]))?.price;
    price = p == null ? null : Number(p);
  }
  return (await one<{ id: string }>(db,
    `INSERT INTO document_line (version_id,endpoint_id,issue_code,description,catalog_item_id,quantity,unit_price,labor_price,labor_covered,part_covered,component,include)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$12,$8,$9,$10,$11) RETURNING id`,
    [versionId, l.endpointId ?? null, l.issueCode ?? null, l.description, l.catalogItemId ?? null, l.quantity ?? 1, price, l.laborCovered ?? false, l.partCovered ?? false, l.component ?? null, l.include ?? true, l.laborPrice ?? null]))!.id;
}

export async function updateLine(db: Db, lineId: string, patch: Partial<LineInput>): Promise<void> {
  const row = await one<{ version_id: string }>(db, `SELECT version_id FROM document_line WHERE id=$1`, [lineId]);
  if (!row) throw new DocumentError('Unknown line.');
  await draftGuard(db, row.version_id);
  const map: Record<string, string> = { description: 'description', catalogItemId: 'catalog_item_id', quantity: 'quantity', unitPrice: 'unit_price', laborPrice: 'labor_price', laborCovered: 'labor_covered', partCovered: 'part_covered', component: 'component', include: 'include', issueCode: 'issue_code' };
  const sets: string[] = []; const vals: unknown[] = [lineId];
  for (const [k, col] of Object.entries(map)) if (k in patch) { vals.push((patch as Record<string, unknown>)[k]); sets.push(`${col}=$${vals.length}`); }
  if (sets.length) await db.query(`UPDATE document_line SET ${sets.join(', ')} WHERE id=$1`, vals);
}

export interface IssueResult { content: FrozenContent; missingFields: string[] }

/** Freeze the version: property snapshot, merged clauses, lines. A Proposal or WA gets its 30-day quote window here. */
export async function issueVersion(db: Db, versionId: string, userId: string | null, issuedOn: string): Promise<IssueResult> {
  await draftGuard(db, versionId);
  const d = await one<{ id: string; type: DocType; number: string; title: string | null; acts_as: string[] | null; property_id: string; version: number;
    salesforce_case: string | null; salesforce_work_order: string | null; quote_valid_until: string | null; charge_code: string | null }>(db,
    `SELECT d.charge_code, d.id, d.type, d.number, d.title, d.acts_as, d.property_id, v.version, d.salesforce_case, d.salesforce_work_order, d.quote_valid_until::text
       FROM document_version v JOIN document d ON d.id=v.document_id WHERE v.id=$1`, [versionId]);
  const p = (await one<{ name: string; class_id: string; address: string | null; access_notes: string | null; scheduling_notes: string | null; city: string | null; state: string | null; zip: string | null }>(db, `SELECT name,class_id,address,access_notes,scheduling_notes,city,state,zip FROM property WHERE id=$1`, [d!.property_id]))!;
  const extra = (await one<{ addressee: string | null; notes: string | null; shipping: string | null; prepared_by: string | null; creator: string | null; initials: string | null }>(db,
    `SELECT d.addressee, d.notes, d.shipping::text, d.prepared_by, u.name creator, u.initials FROM document d LEFT JOIN app_user u ON u.id=d.created_by WHERE d.id=$1`, [d!.id]))!;
  const initialsOf = (n: string | null) => (n ?? '').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('').slice(0, 3) || null;
  const preparedBy = extra.prepared_by ?? extra.initials ?? initialsOf(extra.creator);
  const contact = await one<{ name: string; phone: string | null; email: string | null }>(db, `SELECT name,phone,email FROM contact WHERE property_id=$1 ORDER BY is_primary DESC, name LIMIT 1`, [d!.property_id]);
  const rows = await db.query<{ building: string | null; unit: string | null; address: string | null; service_code: string | null; issue_code: string | null; description: string; component: string | null;
    quantity: string; unit_price: string | null; labor_price: string | null; labor_covered: boolean; part_covered: boolean; include: boolean }>(
    `SELECT b.label building, u.current_label unit, u.service_address address, e.service_code, l.issue_code, l.description, l.component, l.quantity::text, l.unit_price::text, l.labor_price::text, l.labor_covered, l.part_covered, l.include
       FROM document_line l LEFT JOIN endpoint e ON e.id=l.endpoint_id LEFT JOIN unit u ON u.id=e.unit_id LEFT JOIN building b ON b.id=u.building_id
      WHERE l.version_id=$1 ORDER BY b.label NULLS LAST, u.current_label NULLS LAST, l.id`, [versionId]);
  if (!rows.rows.some((r) => r.include)) throw new DocumentError('Nothing is included on this document.');

  const { quoteDays } = await settingsDays(db);
  const quoteValidUntil = d!.type === 'RFM' ? null : (d!.quote_valid_until ?? addDays(issuedOn, quoteDays));
  const ctx = { property: { name: p.name, classId: p.class_id, address: p.address }, document: { number: d!.number, type: d!.type, title: d!.title, issuedOn, quoteValidUntil } };
  const clauses = await db.query<{ key: string; title: string; body: string; applies_when: { types?: string[]; audience?: 'client' | 'tech' } | null }>(
    `SELECT DISTINCT ON (key) key, title, body, applies_when FROM clause_template WHERE active ORDER BY key, version DESC`);
  const missing: string[] = [];
  const picked = clauses.rows.filter((c) => !c.applies_when?.types || c.applies_when.types.includes(d!.type)).map((c) => {
    const m = mergeFields(c.body, ctx); missing.push(...m.missing);
    return { key: c.key, title: c.title, body: m.text, audience: c.applies_when?.audience };
  });

  const lines: FrozenLine[] = rows.rows.map((r) => ({
    building: r.building, unit: r.unit, address: r.address, service: r.service_code, issueCode: r.issue_code, description: r.description, component: r.component,
    quantity: Number(r.quantity), unitPrice: r.unit_price === null ? null : Number(r.unit_price), laborPrice: r.labor_price === null ? null : Number(r.labor_price), laborCovered: r.labor_covered, partCovered: r.part_covered, include: r.include,
  }));
  const sysNotes = await getSystemNotes(db, d!.property_id);
  const content: FrozenContent = {
    number: d!.number, type: d!.type, actsAs: d!.acts_as, title: d!.title, chargeCode: d!.charge_code, version: d!.version, issuedOn, quoteValidUntil,
    property: { name: p.name, classId: p.class_id, address: p.address, accessNotes: p.access_notes, schedulingNotes: p.scheduling_notes, city: p.city, state: p.state, zip: p.zip },
    systemNotes: sysNotes ? { ...sysNotes, bring: bringList(sysNotes, lines) } : null,
    siteContact: contact ?? null, addressee: extra.addressee, notes: extra.notes, shipping: extra.shipping === null ? null : Number(extra.shipping), preparedBy,
    salesforceCase: d!.salesforce_case, salesforceWorkOrder: d!.salesforce_work_order, clauses: picked, lines,
  };
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE document_version SET status='issued', issued_at=now(), issued_by=$2, frozen_content=$3 WHERE id=$1`, [versionId, userId, JSON.stringify(content)]);
    if (quoteValidUntil && !d!.quote_valid_until) await tx.query(`UPDATE document SET quote_valid_until=$2 WHERE id=$1`, [d!.id, quoteValidUntil]);
  });
  await storePdfs(db, versionId, content);
  return { content, missingFields: [...new Set(missing)] };
}

/** Render and keep both PDF copies of an issued version, so what was sent can always be re-sent as it was. */
export async function storePdfs(db: Db, versionId: string, content: FrozenContent): Promise<void> {
  const [client, tech] = await Promise.all([renderPdf(content, 'client'), renderPdf(content, 'tech')]);
  await db.query(`UPDATE document_version SET client_pdf=$2, tech_pdf=$3 WHERE id=$1`, [versionId, client, tech]);
}

/** The stored PDF for an issued version. Versions issued before PDFs existed are rendered once and kept. */
export async function getPdf(db: Db, documentId: string, version: number, audience: 'client' | 'tech'): Promise<{ number: string; bytes: Uint8Array } | null> {
  const v = await one<{ id: string; number: string; status: string; frozen: FrozenContent | null; pdf: Uint8Array | null }>(db,
    `SELECT v.id, d.number, v.status, v.frozen_content frozen, v.${audience === 'client' ? 'client_pdf' : 'tech_pdf'} pdf
       FROM document_version v JOIN document d ON d.id=v.document_id WHERE v.document_id=$1 AND v.version=$2`, [documentId, version]);
  if (!v || v.status !== 'issued' || !v.frozen) return null;
  if (!v.pdf) { await storePdfs(db, v.id, v.frozen); return getPdf(db, documentId, version, audience); }
  return { number: v.number, bytes: v.pdf };
}

/** A new draft copied from the latest version. The quote window carries over; it does not restart. */
export async function newVersion(db: Db, documentId: string): Promise<string> {
  const latest = await one<{ id: string; version: number; status: string }>(db, `SELECT id, version, status FROM document_version WHERE document_id=$1 ORDER BY version DESC LIMIT 1`, [documentId]);
  if (!latest) throw new DocumentError('Unknown document.');
  if (latest.status === 'draft') throw new DocumentError('The latest version is still a draft; edit it directly.');
  let id = '';
  await db.transaction(async (tx) => {
    id = (await one<{ id: string }>(tx, `INSERT INTO document_version (document_id,version) VALUES ($1,$2) RETURNING id`, [documentId, latest.version + 1]))!.id;
    await tx.query(
      `INSERT INTO document_line (version_id,endpoint_id,audit_reading_id,issue_code,description,catalog_item_id,quantity,unit_price,labor_price,labor_covered,part_covered,component,include)
       SELECT $2,endpoint_id,audit_reading_id,issue_code,description,catalog_item_id,quantity,unit_price,labor_price,labor_covered,part_covered,component,include FROM document_line WHERE version_id=$1`, [latest.id, id]);
  });
  return id;
}

export type QuoteStatus = 'not_applicable' | 'valid' | 'expired' | 'reconfirmed';

/** A quote is good 30 days. After that it shows expired but may still be approved when pricing is reconfirmed. */
export async function quoteStatus(db: Db, documentId: string, today: string): Promise<QuoteStatus> {
  const d = await one<{ type: string; quote_valid_until: string | null; price_reconfirmed_on: string | null }>(db,
    `SELECT type, quote_valid_until::text, price_reconfirmed_on::text FROM document WHERE id=$1`, [documentId]);
  if (!d) throw new DocumentError('Unknown document.');
  if (d.type === 'RFM' || !d.quote_valid_until) return 'not_applicable';
  if (today <= d.quote_valid_until) return 'valid';
  return d.price_reconfirmed_on ? 'reconfirmed' : 'expired';
}

export async function reconfirmPricing(db: Db, documentId: string, userId: string, on: string): Promise<void> {
  const st = await quoteStatus(db, documentId, on);
  if (st === 'not_applicable') throw new DocumentError('This document has no quote window.');
  if (st === 'valid') throw new DocumentError('The quote is still valid; nothing to reconfirm.');
  await db.query(`UPDATE document SET price_reconfirmed_by=$2, price_reconfirmed_on=$3 WHERE id=$1`, [documentId, userId, on]);
  await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'price_reconfirmed','document',$2,$3)`, [userId, documentId, JSON.stringify({ on })]);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
async function settingsDays(db: Q): Promise<{ quoteDays: number }> {
  const r = await one<{ value: unknown }>(db, `SELECT value FROM setting WHERE key='quote_valid_days'`);
  return { quoteDays: r ? Number(r.value) : 30 };
}
