// Equipment registry: one row per equipment model. Reports name a model by a short code (TR4, TR201); the registry
// says who makes it, whether it is still current, what replaces it, which catalog part is quoted to replace it,
// and which battery it takes. Prices stay in the catalog (dated), so a model always quotes today's price.
import type { Db } from '../db';

type Q = Pick<Db, 'query'>;
export class EquipmentError extends Error {}

export const KINDS = ['transmitter', 'meter', 'combo', 'repeater', 'collector', 'receiver'] as const;
export type Kind = (typeof KINDS)[number];
export const STATUSES = ['current', 'phasing_out', 'obsolete'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { current: 'Current', phasing_out: 'Phasing out', obsolete: 'Obsolete' };

export interface PartRef { id: string; name: string; price: number | null; partNumber: string | null }
export interface EquipmentModel {
  id: string; manufacturer: string; model: string; kind: Kind; readingSystem: string | null; services: string[]; aliases: string[];
  status: Status; replacedBy: string | null; replacedByLabel: string | null;
  partItemId: string | null; batteryItemId: string | null; batteryLifeYears: number | null; notes: string | null;
  updatedAt: string;
}
export interface ModelInput {
  manufacturer: string; model: string; kind: string; readingSystem?: string | null; services?: string[]; aliases?: string[];
  status?: string; replacedBy?: string | null; partItemId?: string | null; batteryItemId?: string | null; batteryLifeYears?: number | null; notes?: string | null;
}

/** Codes compare without case, spaces or punctuation: "TR-4" = "tr4". */
export const normCode = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
const codesOf = (m: Pick<EquipmentModel, 'model' | 'aliases'>) => [m.model, ...m.aliases].map(normCode).filter(Boolean);

type Row = { id: string; manufacturer: string; model: string; kind: Kind; reading_system: string | null; services: string[]; aliases: string[]; status: Status;
  replaced_by: string | null; replaced_by_label: string | null; part_item_id: string | null; battery_item_id: string | null; battery_life_years: string | null; notes: string | null; updated_at: string };
const toModel = (r: Row): EquipmentModel => ({
  id: r.id, manufacturer: r.manufacturer, model: r.model, kind: r.kind, readingSystem: r.reading_system, services: r.services, aliases: r.aliases,
  status: r.status, replacedBy: r.replaced_by, replacedByLabel: r.replaced_by_label, partItemId: r.part_item_id, batteryItemId: r.battery_item_id,
  batteryLifeYears: r.battery_life_years === null ? null : Number(r.battery_life_years), notes: r.notes, updatedAt: r.updated_at,
});
const SELECT = `SELECT m.id, m.manufacturer, m.model, m.kind, m.reading_system, m.services, m.aliases, m.status, m.replaced_by,
  CASE WHEN r.id IS NULL THEN NULL ELSE r.manufacturer || ' ' || r.model END replaced_by_label,
  m.part_item_id, m.battery_item_id, m.battery_life_years::text, m.notes, m.updated_at::text
  FROM equipment_model m LEFT JOIN equipment_model r ON r.id=m.replaced_by`;

export async function listModels(q: Q): Promise<EquipmentModel[]> {
  return (await q.query<Row>(`${SELECT} ORDER BY m.kind, lower(m.manufacturer), lower(m.model)`)).rows.map(toModel);
}
export async function getModel(q: Q, id: string): Promise<EquipmentModel | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = (await q.query<Row>(`${SELECT} WHERE m.id=$1`, [id])).rows[0];
  return r ? toModel(r) : null;
}

/** The model a report code means, among models of a compatible kind. */
export function findModel(models: EquipmentModel[], code: string | null | undefined, kinds?: Kind[]): EquipmentModel | null {
  const c = normCode(code); if (!c) return null;
  return models.find((m) => (!kinds || kinds.includes(m.kind)) && codesOf(m).includes(c)) ?? null;
}

/**
 * Today's price of a catalog part. Catalog prices are dated rows (a price change adds a row), so the part is
 * followed to its newest row on or before `asOf` with the same part type, name and part number.
 */
export async function currentPart(q: Q, itemId: string | null, asOf: string): Promise<PartRef | null> {
  if (!itemId) return null;
  const r = (await q.query<{ id: string; name: string; price: string | null; part_number: string | null }>(
    `SELECT c2.id, c2.name, c2.price::text, c2.part_number FROM catalog_item c1
       JOIN catalog_item c2 ON lower(c2.name)=lower(c1.name) AND lower(coalesce(c2.part_type,''))=lower(coalesce(c1.part_type,''))
                            AND lower(coalesce(c2.part_number,''))=lower(coalesce(c1.part_number,'')) AND coalesce(c2.source,'')=coalesce(c1.source,'')
      WHERE c1.id=$1 AND c2.effective_from <= $2 ORDER BY c2.effective_from DESC, c2.id LIMIT 1`, [itemId, asOf])).rows[0]
    ?? (await q.query<{ id: string; name: string; price: string | null; part_number: string | null }>(`SELECT id, name, price::text, part_number FROM catalog_item WHERE id=$1`, [itemId])).rows[0];
  return r ? { id: r.id, name: r.name, price: r.price === null ? null : Number(r.price), partNumber: r.part_number } : null;
}

async function validate(q: Q, input: ModelInput, id: string | null): Promise<Required<Omit<ModelInput, 'readingSystem' | 'notes'>> & { readingSystem: string | null; notes: string | null }> {
  const manufacturer = input.manufacturer?.trim(); const model = input.model?.trim();
  if (!manufacturer) throw new EquipmentError('Enter the manufacturer.');
  if (!model) throw new EquipmentError('Enter the model code, as the reports show it (e.g. TR4).');
  if (!(KINDS as readonly string[]).includes(input.kind)) throw new EquipmentError('Choose what kind of equipment this is.');
  const status = (input.status ?? 'current') as Status;
  if (!(STATUSES as readonly string[]).includes(status)) throw new EquipmentError('Unknown status.');
  const aliases = [...new Set((input.aliases ?? []).map((a) => a.trim()).filter((a) => a && normCode(a) !== normCode(model)))];
  const mine = [model, ...aliases].map(normCode);
  if (mine.some((c) => !c)) throw new EquipmentError('Model codes and other names need at least one letter or digit.');
  const others = (await listModels(q)).filter((m) => m.id !== id);
  for (const o of others) {
    const clash = codesOf(o).find((c) => mine.includes(c));
    if (clash && o.kind === input.kind) throw new EquipmentError(`"${clash}" already means ${o.manufacturer} ${o.model}. A code can only mean one ${input.kind} model.`);
  }
  const replacedBy = input.replacedBy || null;
  if (replacedBy) {
    if (replacedBy === id) throw new EquipmentError('A model cannot replace itself.');
    if (!others.some((m) => m.id === replacedBy)) throw new EquipmentError('The replacement model is not in the registry.');
    // Follow the chain to make sure it does not loop back.
    let cur: string | null = replacedBy; const seen = new Set<string>();
    while (cur) {
      if (cur === id || seen.has(cur)) throw new EquipmentError('That replacement would make a loop (A replaced by B replaced by A).');
      seen.add(cur); const at: string = cur; cur = others.find((m) => m.id === at)?.replacedBy ?? null;
    }
  }
  for (const [label, item] of [['part', input.partItemId], ['battery', input.batteryItemId]] as const)
    if (item && !(await q.query(`SELECT 1 FROM catalog_item WHERE id=$1`, [item])).rows.length) throw new EquipmentError(`The ${label} is not in the catalog.`);
  const life = input.batteryLifeYears ?? null;
  if (life !== null && (!Number.isFinite(life) || life <= 0 || life > 50)) throw new EquipmentError('Battery life is in years, from 0.1 to 50.');
  return { manufacturer, model, kind: input.kind, readingSystem: input.readingSystem?.trim() || null, services: [...new Set((input.services ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean))],
    aliases, status, replacedBy, partItemId: input.partItemId || null, batteryItemId: input.batteryItemId || null, batteryLifeYears: life, notes: input.notes?.trim() || null };
}

/** Add a model (no id) or change one. Every change is written to the activity log with what changed. */
export async function saveModel(db: Db, userId: string | null, input: ModelInput, id?: string): Promise<string> {
  const v = await validate(db, input, id ?? null);
  const cols = [v.manufacturer, v.model, v.kind, v.readingSystem, v.services, v.aliases, v.status, v.replacedBy, v.partItemId, v.batteryItemId, v.batteryLifeYears, v.notes];
  if (!id) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO equipment_model (manufacturer,model,kind,reading_system,services,aliases,status,replaced_by,part_item_id,battery_item_id,battery_life_years,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [...cols, userId]).catch(dupe);
    await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'equipment_added','equipment_model',$2,$3)`,
      [userId, r.rows[0].id, JSON.stringify({ model: `${v.manufacturer} ${v.model}`, status: v.status })]);
    return r.rows[0].id;
  }
  const before = await getModel(db, id); if (!before) throw new EquipmentError('That model no longer exists.');
  await db.query(
    `UPDATE equipment_model SET manufacturer=$1, model=$2, kind=$3, reading_system=$4, services=$5, aliases=$6, status=$7, replaced_by=$8, part_item_id=$9,
            battery_item_id=$10, battery_life_years=$11, notes=$12, updated_at=now() WHERE id=$13`, [...cols, id]).catch(dupe);
  const after = (await getModel(db, id))!;
  const changed = Object.fromEntries((['manufacturer', 'model', 'kind', 'readingSystem', 'services', 'aliases', 'status', 'replacedBy', 'partItemId', 'batteryItemId', 'batteryLifeYears', 'notes'] as const)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => [k, { from: before[k], to: after[k] }]));
  if (Object.keys(changed).length)
    await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'equipment_changed','equipment_model',$2,$3)`,
      [userId, id, JSON.stringify({ model: `${after.manufacturer} ${after.model}`, ...changed })]);
  return id;
}
function dupe(e: unknown): never {
  if (e instanceof Error && /equipment_model_name_uq|duplicate key/.test(e.message)) throw new EquipmentError('That manufacturer already has a model with this code.');
  throw e;
}

// ---------- what is in the field ----------
const deviceKinds = (k: Kind): string[] => (k === 'receiver' ? ['collector'] : k === 'transmitter' ? ['transmitter', 'combo'] : [k]);
const modelKinds = (deviceKind: string): Kind[] => (deviceKind === 'transmitter' ? ['transmitter', 'combo'] : deviceKind === 'combo' ? ['combo', 'transmitter'] : deviceKind === 'collector' ? ['collector', 'receiver'] : [deviceKind as Kind]);

export interface FieldCount { model: string; kind: string; devices: number; properties: number }
/** Active devices grouped by the model code the reports gave them. */
export async function fieldCounts(q: Q, propertyId?: string): Promise<FieldCount[]> {
  return (await q.query<{ model: string; kind: string; devices: string; properties: string }>(
    `SELECT d.model, d.kind, count(*) devices, count(DISTINCT d.property_id) properties FROM device d
      WHERE d.status='active' AND COALESCE(trim(d.model),'') <> '' ${propertyId ? 'AND d.property_id=$1' : ''}
      GROUP BY d.model, d.kind ORDER BY count(*) DESC`, propertyId ? [propertyId] : [])).rows
    .map((r) => ({ model: r.model, kind: r.kind, devices: Number(r.devices), properties: Number(r.properties) }));
}

export interface InField { model: EquipmentModel | null; code: string; kind: string; devices: number; properties: number }
/** Field counts matched to the registry; `model` is null for codes the registry does not know yet. */
export async function inField(q: Q, propertyId?: string): Promise<InField[]> {
  const models = await listModels(q);
  return (await fieldCounts(q, propertyId)).map((f) => ({ model: findModel(models, f.model, modelKinds(f.kind)), code: f.model, kind: f.kind, devices: f.devices, properties: f.properties }));
}

// ---------- pricing ----------
/** The model of the equipment of this component currently installed at an endpoint. */
export async function modelAt(q: Q, endpointId: string, component: 'transmitter' | 'meter'): Promise<EquipmentModel | null> {
  const kinds = component === 'meter' ? ['meter'] : ['transmitter', 'combo'];
  const d = (await q.query<{ model: string | null; kind: string }>(
    `SELECT d.model, d.kind FROM installation i JOIN device d ON d.id=i.device_id
      WHERE i.endpoint_id=$1 AND i.removed_on IS NULL AND d.status='active' AND d.kind = ANY($2) AND COALESCE(trim(d.model),'') <> ''
      ORDER BY i.installed_on DESC NULLS LAST LIMIT 1`, [endpointId, kinds])).rows[0];
  return d ? findModel(await listModels(q), d.model, modelKinds(d.kind)) : null;
}

export interface ReplacementQuote { model: EquipmentModel; quoted: EquipmentModel; part: PartRef | null; note: string | null }
/**
 * What to quote when the equipment at an endpoint needs replacing. An obsolete or phasing-out model with a
 * replacement set is quoted as its replacement (followed down the chain), with a note saying so.
 */
export async function replacementFor(q: Q, endpointId: string, component: 'transmitter' | 'meter', asOf: string): Promise<ReplacementQuote | null> {
  const model = await modelAt(q, endpointId, component); if (!model) return null;
  const all = await listModels(q);
  let quoted = model; const seen = new Set<string>();
  while (quoted.status !== 'current' && quoted.replacedBy && !seen.has(quoted.id)) { seen.add(quoted.id); quoted = all.find((m) => m.id === quoted.replacedBy) ?? quoted; }
  const note = quoted.id !== model.id ? `${model.model} is ${STATUS_LABEL[model.status].toLowerCase()}; replace with ${quoted.model}` : null;
  return { model, quoted, part: await currentPart(q, quoted.partItemId, asOf), note };
}

/** The battery a transmitter model takes, from the registry. Null when the model or its battery is not set. */
export async function batteryForModel(q: Q, code: string | null, asOf: string): Promise<PartRef | null> {
  const m = findModel(await listModels(q), code, ['transmitter', 'combo', 'repeater']);
  return m ? currentPart(q, m.batteryItemId, asOf) : null;
}

// ---------- suggestions from the catalog ----------
const tokens = (s: string | null | undefined) => (s ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

export interface CatalogOption { id: string; name: string; partNumber: string | null; partType: string | null; vendor: string | null; notes: string | null; price: number | null; obsolete: boolean }
/** Newest row of each catalog part of the given components (what a picker should list). */
export async function catalogOptions(q: Q, components: string[]): Promise<CatalogOption[]> {
  return (await q.query<{ id: string; name: string; part_number: string | null; part_type: string | null; vendor: string | null; notes: string | null; price: string | null; active: boolean }>(
    `SELECT DISTINCT ON (lower(name), lower(coalesce(part_type,'')), lower(coalesce(part_number,''))) id, name, part_number, part_type, vendor, notes, price::text, active
       FROM catalog_item WHERE kind='part' AND component = ANY($1)
      ORDER BY lower(name), lower(coalesce(part_type,'')), lower(coalesce(part_number,'')), effective_from DESC`, [components])).rows
    .map((r) => ({ id: r.id, name: r.name, partNumber: r.part_number, partType: r.part_type, vendor: r.vendor, notes: r.notes, price: r.price === null ? null : Number(r.price), obsolete: !r.active }))
    .sort((a, b) => Number(a.obsolete) - Number(b.obsolete) || a.name.localeCompare(b.name));
}

/**
 * Catalog parts that name a model code as a whole word (in the name, part number or notes): e.g. the TR4 battery
 * "CR18505 Transmitter Batteries for TR4" or the part "NC-TR4". Fewest extra words first. Suggestions only:
 * a person picks them on the form.
 */
export function suggestParts(options: CatalogOption[], codes: string[]): CatalogOption[] {
  const want = new Set(codes.map(normCode).filter(Boolean));
  // A part number may carry a vendor prefix: NC-TR4-X is the TR4X.
  const pn = (o: CatalogOption) => [...want].some((c) => normCode(o.partNumber).endsWith(c));
  const hits = options.filter((o) => !o.obsolete && (pn(o) || [o.name, o.partNumber, o.notes].some((t) => tokens(t).some((x) => want.has(x)))));
  const extra = (o: CatalogOption) => tokens(o.partNumber ?? o.name).filter((x) => !want.has(x)).length;
  return hits.sort((a, b) => extra(a) - extra(b) || a.name.localeCompare(b.name));
}
