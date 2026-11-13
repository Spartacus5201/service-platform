// Literal search across properties, units, devices, service visits and documents.
// Every word must appear somewhere in the same record (case-insensitive, any order). "1-101" also finds building 1 unit 101.
// Semantic search (embeddings) is a later layer over the same records.
import type { Db } from '../db';
import { normLabel } from '../parsers/common';

export type HitKind = 'property' | 'unit' | 'device' | 'service' | 'document';
export interface Hit { kind: HitKind; title: string; sub: string; href: string; note?: string; rank: number }
export interface SearchOptions { includeDocuments: boolean; perKind?: number }

const esc = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export function tokens(q: string): string[] {
  return [...new Set(q.trim().split(/\s+/).filter((t) => t.length > 0).map((t) => t.slice(0, 60)))].slice(0, 8);
}

export async function search(db: Db, q: string, o: SearchOptions): Promise<Hit[]> {
  const toks = tokens(q);
  if (!toks.length || q.trim().length < 2) return [];
  const per = o.perKind ?? 15;
  const pats = toks.map((t) => `%${esc(t)}%`);
  const where = (hay: string) => pats.map((_, i) => `${hay} ILIKE $${i + 1}`).join(' AND ');
  const exact = (cols: string[]) => `CASE WHEN lower(${cols.join(`) = ANY($${pats.length + 1}) OR lower(`)}) = ANY($${pats.length + 1}) THEN 0 ELSE 1 END`;
  const lower = toks.map((t) => t.toLowerCase());
  const args = [...pats, lower];
  const hits: Hit[] = [];

  // properties
  for (const r of (await db.query<{ id: string; class_id: string; name: string; address: string | null; rank: number }>(
    `SELECT id, class_id, name, address, ${exact(['class_id', 'name'])} rank FROM property WHERE ${where(`concat_ws(' ', class_id, name, address, billing_code, salesforce_account_ref)`)} ORDER BY rank, name LIMIT ${per}`, args)).rows)
    hits.push({ kind: 'property', title: r.name, sub: `ClassID ${r.class_id}${r.address ? ` · ${r.address}` : ''}`, href: `/properties/${r.id}`, rank: r.rank });

  // units (building-unit pairs such as "1-101" also match on the normalized labels)
  const unitArgs: unknown[] = [...args];
  const pairSql = toks.map((tk) => {
    const m = /^([\w]+)-([\w]+)$/.exec(tk);
    if (!m) return null;
    unitArgs.push(normLabel(m[1]), normLabel(m[2]));
    const n = unitArgs.length;
    return `EXISTS (SELECT 1 FROM unit_alias a WHERE a.unit_id=u.id AND a.building_label=$${n - 1} AND a.unit_label=$${n})`;
  });
  const unitHay = `concat_ws(' ', b.label, u.current_label, u.service_address, e.service_code, e.vendor_label, p.name, p.class_id)`;
  const unitWhere = pats.map((_, i) => (pairSql[i] ? `(${unitHay} ILIKE $${i + 1} OR ${pairSql[i]})` : `${unitHay} ILIKE $${i + 1}`)).join(' AND ');
  for (const r of (await db.query<{ endpoint_id: string; building: string; unit: string; address: string | null; service: string; property: string; rank: number }>(
    `SELECT e.id endpoint_id, b.label building, u.current_label unit, u.service_address address, e.service_code service, p.name property,
            ${exact(['u.current_label', 'e.vendor_label'])} rank
       FROM endpoint e JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id JOIN property p ON p.id=b.property_id
      WHERE ${unitWhere} ORDER BY rank, p.name, b.label, u.current_label LIMIT ${per}`, unitArgs)).rows)
    hits.push({ kind: 'unit', title: `${r.building}-${r.unit} ${r.service}`, sub: `${r.property}${r.address ? ` · ${r.address}` : ''}`, href: `/endpoints/${r.endpoint_id}`, rank: r.rank });

  // devices: where it is now, or where it last was
  for (const r of (await db.query<{ kind: string; hw: string | null; serial: string | null; model: string | null; property: string; property_id: string; endpoint_id: string | null; building: string | null; unit: string | null; removed: string | null; rank: number }>(
    `SELECT d.kind, d.hardware_id hw, d.serial_number serial, d.model, p.name property, p.id property_id, i.endpoint_id, b.label building, u.current_label unit, i.removed_on::text removed,
            ${exact(['d.hardware_id', 'd.serial_number'])} rank
       FROM device d JOIN property p ON p.id=d.property_id
       LEFT JOIN LATERAL (SELECT * FROM installation x WHERE x.device_id=d.id ORDER BY x.removed_on NULLS FIRST, x.installed_on DESC NULLS LAST LIMIT 1) i ON true
       LEFT JOIN endpoint e ON e.id=i.endpoint_id LEFT JOIN unit u ON u.id=e.unit_id LEFT JOIN building b ON b.id=u.building_id
      WHERE ${where(`concat_ws(' ', d.hardware_id, d.serial_number, d.model, d.kind)`)} ORDER BY rank, d.hardware_id LIMIT ${per}`, args)).rows)
    hits.push({ kind: 'device', title: `${r.kind} ${r.hw ?? r.serial ?? '(no ID)'}`, rank: r.rank,
      sub: `${r.property}${r.building ? ` · ${r.building}-${r.unit}` : ''}${r.removed ? ` · removed ${r.removed}` : ''}${r.model ? ` · ${r.model}` : ''}`,
      href: r.endpoint_id ? `/endpoints/${r.endpoint_id}` : `/properties/${r.property_id}` });

  // service history: notes, technician, Case and Work Order numbers (superseded events are not searched)
  for (const r of (await db.query<{ endpoint_id: string; visited_on: string; building: string; unit: string; service: string; property: string; action: string; notes: string | null; kase: string | null; wo: string | null; rank: number }>(
    `SELECT e.id endpoint_id, v.visited_on::text, b.label building, u.current_label unit, e.service_code service, p.name property, se.action, concat_ws(' — ', se.notes, v.notes) notes,
            v.salesforce_case kase, v.salesforce_work_order wo, ${exact(['v.salesforce_case', 'v.salesforce_work_order'])} rank
       FROM service_event se JOIN visit v ON v.id=se.visit_id JOIN endpoint e ON e.id=se.endpoint_id JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id JOIN property p ON p.id=b.property_id
      WHERE NOT se.voided AND NOT EXISTS (SELECT 1 FROM service_event n WHERE n.supersedes=se.id)
        AND ${where(`concat_ws(' ', se.notes, v.notes, v.technician, v.salesforce_case, v.salesforce_work_order, se.issue_code, se.action)`)}
      ORDER BY rank, v.visited_on DESC LIMIT ${per}`, args)).rows)
    hits.push({ kind: 'service', rank: r.rank, title: `${r.visited_on} · ${r.building}-${r.unit} ${r.service} · ${r.action.replace('_', '/')}`,
      sub: `${r.property}${r.kase ? ` · Case ${r.kase}` : ''}${r.wo ? ` · WO ${r.wo}` : ''}`, note: r.notes ?? undefined, href: `/endpoints/${r.endpoint_id}` });

  if (o.includeDocuments) {
    for (const r of (await db.query<{ id: string; number: string; type: string; title: string | null; property: string; kase: string | null; wo: string | null; rank: number }>(
      `SELECT d.id, d.number, d.type, d.title, p.name property, d.salesforce_case kase, d.salesforce_work_order wo, ${exact(['d.number', 'd.salesforce_case', 'd.salesforce_work_order'])} rank
         FROM document d JOIN property p ON p.id=d.property_id
        WHERE ${where(`concat_ws(' ', d.number, d.title, d.type, d.salesforce_case, d.salesforce_work_order, p.name)`)} ORDER BY rank, d.created_at DESC LIMIT ${per}`, args)).rows)
      hits.push({ kind: 'document', rank: r.rank, title: `${r.type} ${r.number}`, sub: `${r.property}${r.title ? ` · ${r.title}` : ''}${r.kase ? ` · Case ${r.kase}` : ''}${r.wo ? ` · WO ${r.wo}` : ''}`, href: `/documents/${r.id}` });
  }
  return hits;
}
