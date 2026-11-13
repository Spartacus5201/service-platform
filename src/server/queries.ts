import type { Db } from '../db';

export interface PropertyRow { id: string; class_id: string; name: string; installed_by_us: boolean; units: number; last_audit: string | null; docs: number }

export async function listProperties(db: Db): Promise<PropertyRow[]> {
  const r = await db.query<{ id: string; class_id: string; name: string; installed_by_us: boolean; units: string; last_audit: string | null; docs: string }>(
    `SELECT p.id, p.class_id, p.name, p.installed_by_us,
            (SELECT count(*) FROM unit u JOIN building b ON b.id=u.building_id WHERE b.property_id=p.id) units,
            (SELECT max(imported_at)::date::text FROM import_batch i WHERE i.property_id=p.id AND i.kind IN ('auto_audit','manual_audit')) last_audit,
            (SELECT count(*) FROM document d WHERE d.property_id=p.id) docs
       FROM property p ORDER BY p.name`);
  return r.rows.map((x) => ({ ...x, units: Number(x.units), docs: Number(x.docs) }));
}

export async function getProperty(db: Db, id: string) {
  const r = await db.query<{ id: string; class_id: string; name: string; address: string | null; billing_code: string | null; installed_by_us: boolean; billing_contract: boolean; msa: boolean; city: string | null; state: string | null; zip: string | null;
    install_completed_on: string | null; salesforce_account_ref: string | null; access_notes: string | null; scheduling_notes: string | null }>(
    `SELECT id,class_id,name,address,billing_code,installed_by_us,billing_contract,msa,city,state,zip,install_completed_on::text,salesforce_account_ref,access_notes,scheduling_notes FROM property WHERE id=$1`, [id]);
  return r.rows[0] ?? null;
}

export interface UnitRow {
  endpointId: string; building: string; unit: string; address: string | null; service: string; isManual: boolean;
  moveInOn: string | null; occupancyKnown: boolean; transmitter: string | null; lastCheckIn: string | null;
}

export async function propertyUnits(db: Db, propertyId: string): Promise<UnitRow[]> {
  const r = await db.query<{ id: string; building: string; unit: string; address: string | null; service_code: string; is_manual_read: boolean; move_in_on: string | null;
    occupancy_as_of: string | null; hardware_id: string | null; last_checkin: string | null }>(
    `SELECT e.id, b.label building, u.current_label unit, u.service_address address, e.service_code, e.is_manual_read, u.move_in_on::text, u.occupancy_as_of::text,
            (SELECT d.hardware_id FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=e.id AND d.kind='transmitter' AND i.removed_on IS NULL AND d.status='active' LIMIT 1) hardware_id,
            (SELECT max(c.checked_in_at)::text FROM device_checkin c JOIN installation i ON i.device_id=c.device_id WHERE i.endpoint_id=e.id AND i.removed_on IS NULL) last_checkin
       FROM endpoint e JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id
      WHERE b.property_id=$1 ORDER BY b.label, u.current_label, e.service_code`, [propertyId]);
  return r.rows.map((x) => ({ endpointId: x.id, building: x.building, unit: x.unit, address: x.address, service: x.service_code, isManual: x.is_manual_read,
    moveInOn: x.move_in_on, occupancyKnown: x.occupancy_as_of !== null, transmitter: x.hardware_id, lastCheckIn: x.last_checkin }));
}

export async function propertyImports(db: Db, propertyId: string) {
  const r = await db.query<{ id: string; kind: string; filename: string | null; imported_at: string; summary: Record<string, number>; raw_file: boolean; purge_after: string }>(
    `SELECT id, kind, filename, imported_at::text, summary, raw_file IS NOT NULL raw_file, purge_after::text FROM import_batch WHERE property_id=$1 ORDER BY imported_at DESC LIMIT 25`, [propertyId]);
  return r.rows;
}

export async function propertyDocuments(db: Db, propertyId: string) {
  const r = await db.query<{ id: string; number: string; type: string; title: string | null; salesforce_case: string | null; created_at: string; version: number; status: string; quote_valid_until: string | null }>(
    `SELECT d.id, d.number, d.type, d.title, d.salesforce_case, d.created_at::date::text created_at, v.version, v.status, d.quote_valid_until::text
       FROM document d JOIN LATERAL (SELECT version, status FROM document_version WHERE document_id=d.id ORDER BY version DESC LIMIT 1) v ON true
      WHERE d.property_id=$1 ORDER BY d.created_at DESC`, [propertyId]);
  return r.rows;
}

export async function catalogItems(db: Db) {
  const r = await db.query<{ id: string; name: string; description: string | null; kind: string; component: string | null; unit: string; price: string | null; effective_from: string; part_type: string | null; vendor: string | null; part_number: string | null; notes: string | null; suggest_default: boolean }>(
    `SELECT * FROM (
       SELECT DISTINCT ON (kind, lower(name), lower(coalesce(part_number,'')), lower(coalesce(part_type,'')))
              id,name,description,kind,component,unit,price::text,effective_from::text, part_type, vendor, part_number, notes, suggest_default, active
         FROM catalog_item WHERE effective_from <= current_date
        ORDER BY kind, lower(name), lower(coalesce(part_number,'')), lower(coalesce(part_type,'')), effective_from DESC) latest
      WHERE active ORDER BY coalesce(part_type,''), lower(name)`);
  return r.rows;
}
