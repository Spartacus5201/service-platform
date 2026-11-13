// Writes a parsed report into the database. One transaction per import; re-importing the same file is a no-op.
import { confirmIdUpdates } from '../service/verify';
import { createHash } from 'node:crypto';
import type { Db } from '../db';
import { normLabel } from '../parsers/common';
import type { Parsed } from '../parsers';
import type { AuditParse } from '../parsers/audit';
import type { CimParse } from '../parsers/cim';
import type { PsrParse } from '../parsers/psr';
import type { UnitDirectoryParse } from '../parsers/unitdirectory';

export type ImportKind = 'auto_audit' | 'manual_audit' | 'occupancy' | 'cim_nextcentury' | 'cim_inovonics' | 'psr' | 'unit_directory';

export interface ImportOptions {
  /** Create units, endpoints and aliases the registry does not know yet (first import of a property). */
  createMissing?: boolean;
  /** 'occupancy' uses an Auto Audit file only for move-in dates; its reads and AuditResult are ignored. */
  as?: 'occupancy';
  importedBy?: string;
  filename?: string;
  fileBytes?: Uint8Array;
  /** PSR rows carry no utility; defaults to water. */
  defaultServiceCode?: string;
  allowClassMismatch?: boolean;
}

export interface ImportResult {
  batchId: string | null;
  kind: ImportKind;
  duplicate: boolean;
  readings: number;
  devices: number;
  checkins: number;
  unitsCreated: number;
  occupancyUpdated: number;
  unmatched: { building: string; unit: string; service: string }[];
  idChanges: { building: string; unit: string; was: string; now: string }[];
  warnings: string[];
}

export class ImportError extends Error {}

type Q = Pick<Db, 'query'>;

const one = async <T>(q: Q, sql: string, p: unknown[] = []): Promise<T | undefined> =>
  (await q.query<T>(sql, p)).rows[0];

class Registry {
  private aliases = new Map<string, string>();      // "b|u" -> unit_id
  private buildings = new Map<string, string>();    // normalized label -> building_id
  private endpoints = new Map<string, string>();    // "unit|service" -> endpoint_id
  unitsCreated = 0;

  constructor(private q: Q, private propertyId: string, private createMissing: boolean) {}

  async load() {
    const a = await this.q.query<{ b: string; u: string; unit_id: string }>(
      `SELECT building_label b, unit_label u, unit_id FROM unit_alias WHERE property_id=$1`, [this.propertyId]);
    a.rows.forEach((r) => this.aliases.set(`${r.b}|${r.u}`, r.unit_id));
    const b = await this.q.query<{ id: string; label: string }>(`SELECT id, label FROM building WHERE property_id=$1`, [this.propertyId]);
    b.rows.forEach((r) => this.buildings.set(normLabel(r.label), r.id));
  }

  async unit(building: string, unit: string, source: string): Promise<string | null> {
    const b = normLabel(building), u = normLabel(unit);
    const hit = this.aliases.get(`${b}|${u}`);
    if (hit) return hit;
    if (!this.createMissing) return null;
    let bid = this.buildings.get(b);
    if (!bid) {
      bid = (await one<{ id: string }>(this.q, `INSERT INTO building (property_id,label) VALUES ($1,$2) RETURNING id`, [this.propertyId, building.trim()]))!.id;
      this.buildings.set(b, bid);
    }
    const uid = (await one<{ id: string }>(this.q, `INSERT INTO unit (building_id,current_label) VALUES ($1,$2) RETURNING id`, [bid, unit.trim()]))!.id;
    await this.q.query(`INSERT INTO unit_alias (unit_id,property_id,building_label,unit_label,source) VALUES ($1,$2,$3,$4,$5)`, [uid, this.propertyId, b, u, source]);
    this.aliases.set(`${b}|${u}`, uid);
    this.unitsCreated++;
    return uid;
  }

  async endpoint(building: string, unit: string, service: string, source: string, extra: { vendorLabel?: string | null; manual?: boolean } = {}): Promise<string | null> {
    const uid = await this.unit(building, unit, source);
    if (!uid) return null;
    const key = `${uid}|${service}`;
    let id = this.endpoints.get(key);
    if (!id) {
      const row = await one<{ id: string }>(this.q, `SELECT id FROM endpoint WHERE unit_id=$1 AND service_code=$2`, [uid, service]);
      if (row) id = row.id;
      else if (this.createMissing) {
        id = (await one<{ id: string }>(this.q,
          `INSERT INTO endpoint (unit_id,service_code,vendor_label,is_manual_read) VALUES ($1,$2,$3,$4) RETURNING id`,
          [uid, service, extra.vendorLabel ?? null, extra.manual ?? false]))!.id;
      } else return null;
      this.endpoints.set(key, id);
    }
    if (extra.manual !== undefined || extra.vendorLabel) {
      await this.q.query(
        `UPDATE endpoint SET is_manual_read = COALESCE($2, is_manual_read), vendor_label = COALESCE($3, vendor_label) WHERE id=$1`,
        [id, extra.manual ?? null, extra.vendorLabel ?? null]);
    }
    return id;
  }
}

/** Find or create a device by radio ID within the property. */
async function upsertDevice(q: Q, propertyId: string, kind: string, hardwareId: string, extra: { model?: string | null; serial?: string | null } = {}): Promise<{ id: string; created: boolean }> {
  const row = await one<{ id: string }>(q, `SELECT id FROM device WHERE property_id=$1 AND kind=$2 AND hardware_id=$3`, [propertyId, kind, hardwareId]);
  if (row) {
    if (extra.model || extra.serial) await q.query(`UPDATE device SET model=COALESCE($2,model), serial_number=COALESCE($3,serial_number) WHERE id=$1`, [row.id, extra.model ?? null, extra.serial ?? null]);
    return { id: row.id, created: false };
  }
  const d = await one<{ id: string }>(q,
    `INSERT INTO device (property_id,kind,hardware_id,model,serial_number) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [propertyId, kind, hardwareId, extra.model ?? null, extra.serial ?? null]);
  return { id: d!.id, created: true };
}

/** Meters carry no readable ID, so each endpoint gets one placeholder meter. */
async function ensurePlaceholderMeter(q: Q, propertyId: string, endpointId: string, installedOn: string | null, origin: string, model?: string | null, serial?: string | null) {
  const has = await one(q, `SELECT 1 FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=$1 AND d.kind='meter' AND i.removed_on IS NULL AND d.status='active'`, [endpointId]);
  if (has) return;
  const d = await one<{ id: string }>(q,
    `INSERT INTO device (property_id,kind,model,serial_number,is_placeholder) VALUES ($1,'meter',$2,$3,$4) RETURNING id`,
    [propertyId, model ?? null, serial ?? null, !serial]);
  await q.query(`INSERT INTO installation (device_id,property_id,endpoint_id,installed_on,origin) VALUES ($1,$2,$3,$4,$5)`, [d!.id, propertyId, endpointId, installedOn, origin]);
}

/** Make sure `deviceId` is installed at the endpoint (or the property when endpointId is null). Returns true when a row was added. */
async function ensureInstalled(q: Q, propertyId: string, deviceId: string, endpointId: string | null, installedOn: string | null, origin: string): Promise<boolean> {
  const has = await one(q, `SELECT 1 FROM installation WHERE device_id=$1 AND removed_on IS NULL AND endpoint_id IS NOT DISTINCT FROM $2`, [deviceId, endpointId]);
  if (has) {
    if (installedOn) await q.query(`UPDATE installation SET installed_on=COALESCE(installed_on,$3) WHERE device_id=$1 AND removed_on IS NULL AND endpoint_id IS NOT DISTINCT FROM $2`, [deviceId, endpointId, installedOn]);
    return false;
  }
  await q.query(`INSERT INTO installation (device_id,property_id,endpoint_id,installed_on,origin) VALUES ($1,$2,$3,$4,$5)`, [deviceId, propertyId, endpointId, installedOn, origin]);
  return true;
}

function emptyResult(kind: ImportKind): ImportResult {
  return { batchId: null, kind, duplicate: false, readings: 0, devices: 0, checkins: 0, unitsCreated: 0, occupancyUpdated: 0, unmatched: [], idChanges: [], warnings: [] };
}

export async function importParsed(db: Db, propertyId: string, parsed: Parsed, opts: ImportOptions = {}): Promise<ImportResult> {
  const kind: ImportKind = opts.as === 'occupancy' && parsed.kind !== 'unit_directory' ? 'occupancy' : parsed.kind;
  if (opts.as === 'occupancy' && parsed.kind !== 'auto_audit' && parsed.kind !== 'unit_directory') throw new ImportError('An occupancy import must be an Auto Audit format file.');

  const prop = await one<{ class_id: string; name: string }>(db, `SELECT class_id, name FROM property WHERE id=$1`, [propertyId]);
  if (!prop) throw new ImportError('Unknown property.');
  if ('classId' in parsed && parsed.classId && parsed.classId.trim() !== prop.class_id && !opts.allowClassMismatch) {
    throw new ImportError(`This file is for ClassID ${parsed.classId.trim()}, but the selected property is ${prop.class_id}.`);
  }

  const bytes = opts.fileBytes ?? new TextEncoder().encode(JSON.stringify(parsed));
  const sha = createHash('sha256').update(bytes).digest('hex');
  const dup = await one<{ id: string }>(db, `SELECT id FROM import_batch WHERE property_id=$1 AND kind=$2 AND sha256=$3`, [propertyId, kind, sha]);
  if (dup) return { ...emptyResult(kind), batchId: dup.id, duplicate: true, warnings: ['This exact file was already imported; nothing changed.'] };

  const res = emptyResult(kind);
  await db.transaction(async (tx) => {
    const batch = await one<{ id: string }>(tx,
      `INSERT INTO import_batch (property_id,kind,filename,sha256,imported_by,raw_file,purge_after)
       VALUES ($1,$2,$3,$4,$5,$6, current_date + COALESCE((SELECT (value #>> '{}')::int FROM setting WHERE key='raw_import_retention_days'), 180)) RETURNING id`,
      [propertyId, kind, opts.filename ?? null, sha, opts.importedBy ?? null, kind === 'unit_directory' ? null : (opts.fileBytes ?? null)]);   // the file holds resident names: keep none of it
    res.batchId = batch!.id;
    const reg = new Registry(tx, propertyId, !!opts.createMissing);
    await reg.load();

    if (parsed.kind === 'unit_directory') await importUnitDirectory(tx, res, reg, parsed, kind);
    else if ('rows' in parsed) await importAudit(tx, propertyId, res, reg, parsed, kind, opts);
    else if ('devices' in parsed) await importCim(tx, propertyId, res, reg, parsed, kind);
    else await importPsr(tx, propertyId, res, reg, parsed, opts);

    res.unitsCreated = reg.unitsCreated;
    if (kind !== 'psr' && kind !== 'occupancy' && kind !== 'unit_directory') await confirmIdUpdates(tx, propertyId);
    res.warnings.push(...(('warnings' in parsed ? parsed.warnings : []) as string[]));
    await tx.query(`UPDATE import_batch SET summary=$2 WHERE id=$1`, [res.batchId, JSON.stringify({
      readings: res.readings, devices: res.devices, checkins: res.checkins, unitsCreated: res.unitsCreated,
      occupancyUpdated: res.occupancyUpdated, unmatched: res.unmatched.length, idChanges: res.idChanges.length,
    })]);
  });
  return res;
}

/** Occupancy from a Unit Directory: move-in date per unit. Units the registry does not know are reported, not created. */
async function importUnitDirectory(q: Q, res: ImportResult, reg: Registry, p: UnitDirectoryParse, kind: ImportKind) {
  for (const r of p.rows) {
    const uid = await reg.unit(r.building, r.unit, kind);
    if (!uid) { res.unmatched.push({ building: r.building, unit: r.unit, service: '' }); continue; }
    await q.query(`UPDATE unit SET move_in_on=$2, prior_move_out_on=$3, occupancy_source=$4, occupancy_as_of=current_date WHERE id=$1`, [uid, r.moveInOn, r.priorMoveOutOn, kind]);
    res.occupancyUpdated++;
  }
}

async function importAudit(q: Q, propertyId: string, res: ImportResult, reg: Registry, p: AuditParse, kind: ImportKind, opts: ImportOptions) {
  const readingsWanted = kind !== 'occupancy';
  for (const r of p.rows) {
    const eid = await reg.endpoint(r.building, r.unit, r.serviceCode, kind, {
      vendorLabel: r.vendorLabel, manual: p.kind === 'manual_audit' ? r.isManual : undefined,
    });
    if (!eid) { res.unmatched.push({ building: r.building.trim(), unit: r.unit.trim(), service: r.serviceCode }); continue; }

    if (r.port !== null || r.net !== null) await q.query(`UPDATE endpoint SET port=COALESCE($2,port), net=COALESCE($3,net) WHERE id=$1`, [eid, r.port, r.net]);
    if (r.address) {
      await q.query(`UPDATE unit SET service_address=$2 WHERE id=(SELECT unit_id FROM endpoint WHERE id=$1)`, [eid, r.address]);
    }
    if (r.occupancy) {
      const uid = (await one<{ unit_id: string }>(q, `SELECT unit_id FROM endpoint WHERE id=$1`, [eid]))!.unit_id;
      await q.query(`UPDATE unit SET move_in_on=$2, prior_move_out_on=$3, occupancy_source=$4, occupancy_as_of=current_date WHERE id=$1`,
        [uid, r.occupancy.moveInOn, r.occupancy.priorMoveOutOn, kind]);
      res.occupancyUpdated++;
    }
    if (!readingsWanted) continue;

    await q.query(
      `INSERT INTO audit_reading (import_batch_id,endpoint_id,read_date_1,read_1,read_date_2,read_2,usage,occ_days,read_count,audit_result,meter_type_id,manufacturer_id,amr_id,last_real_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [res.batchId, eid, r.readDate1, r.read1, r.readDate2, r.read2, r.usage, r.occDays, r.readCount, r.auditResult, r.meterTypeId, r.manufacturerId, r.amrId, r.lastRealOn]);
    res.readings++;

    await ensurePlaceholderMeter(q, propertyId, eid, null, 'import');
    if (r.amrId) {
      const cur = await one<{ hardware_id: string }>(q,
        `SELECT d.hardware_id FROM installation i JOIN device d ON d.id=i.device_id
          WHERE i.endpoint_id=$1 AND d.kind='transmitter' AND i.removed_on IS NULL AND d.status='active'`, [eid]);
      if (cur && cur.hardware_id !== r.amrId) {
        res.idChanges.push({ building: r.building.trim(), unit: r.unit.trim(), was: cur.hardware_id, now: r.amrId });
      } else if (!cur) {
        const d = await upsertDevice(q, propertyId, 'transmitter', r.amrId);
        if (d.created) res.devices++;
        await ensureInstalled(q, propertyId, d.id, eid, null, 'import');
      }
    }
  }
}

async function importCim(q: Q, propertyId: string, res: ImportResult, reg: Registry, p: CimParse, kind: ImportKind) {
  for (const rep of p.repeaters) {
    const d = await upsertDevice(q, propertyId, 'repeater', rep.hardwareId);
    if (d.created) res.devices++;
    if (rep.location) await q.query(`UPDATE device SET location=$2 WHERE id=$1`, [d.id, rep.location]);
    await ensureInstalled(q, propertyId, d.id, null, null, 'import');
    await q.query(`INSERT INTO device_checkin (import_batch_id,device_id,checked_in_at) VALUES ($1,$2,$3)`, [res.batchId, d.id, rep.lastCheckIn]);
    res.checkins++;
  }
  for (const dev of p.devices) {
    if (!dev.hardwareId) { res.warnings.push(`Unit ${dev.building}-${dev.unit}: no transmitter ID, skipped.`); continue; }
    const eid = await reg.endpoint(dev.building, dev.unit, dev.serviceCode, kind, { vendorLabel: dev.meterLabel });
    if (!eid) { res.unmatched.push({ building: dev.building, unit: dev.unit, service: dev.serviceCode }); continue; }
    const cur = await one<{ hardware_id: string }>(q,
      `SELECT d.hardware_id FROM installation i JOIN device d ON d.id=i.device_id
        WHERE i.endpoint_id=$1 AND d.kind='transmitter' AND i.removed_on IS NULL AND d.status='active'`, [eid]);
    if (cur && cur.hardware_id !== dev.hardwareId) {
      res.idChanges.push({ building: dev.building, unit: dev.unit, was: cur.hardware_id, now: dev.hardwareId });
      continue;
    }
    const d = await upsertDevice(q, propertyId, 'transmitter', dev.hardwareId);
    if (d.created) res.devices++;
    await ensureInstalled(q, propertyId, d.id, eid, null, 'import');
    await ensurePlaceholderMeter(q, propertyId, eid, null, 'import', dev.meterModel);
    await q.query(
      `INSERT INTO device_checkin (import_batch_id,device_id,checked_in_at,low_battery,tamper,jammed,power_loss,reset,signal_level,signal_margin,pulse_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [res.batchId, d.id, dev.lastCheckIn, dev.lowBattery, dev.tamper, dev.jammed, dev.powerLoss, dev.reset, dev.signalLevel, dev.signalMargin, dev.pulseCount]);
    res.checkins++;
  }
}

async function importPsr(q: Q, propertyId: string, res: ImportResult, reg: Registry, p: PsrParse, opts: ImportOptions) {
  // A PSR exists only for installs we performed: it anchors the install warranty on the latest install date.
  await q.query(`UPDATE property SET installed_by_us=true, install_completed_on=COALESCE($2, install_completed_on) WHERE id=$1`, [propertyId, p.completedOn]);
  for (const e of p.equipment) {
    // PSR serials appear to match CIM repeater IDs; the same key lets the two reports meet on one device.
    const d = e.serial ? await upsertDevice(q, propertyId, e.kind, e.serial, { serial: e.serial })
      : { id: (await one<{ id: string }>(q, `INSERT INTO device (property_id,kind) VALUES ($1,$2) RETURNING id`, [propertyId, e.kind]))!.id, created: true };
    if (d.created) res.devices++;
    const added = await ensureInstalled(q, propertyId, d.id, null, e.installedOn, 'install_project');
    if (added && e.location) await q.query(`UPDATE installation SET location_note=$2 WHERE device_id=$1 AND removed_on IS NULL`, [d.id, e.location]);
  }
  const service = opts.defaultServiceCode ?? 'WS';
  for (const u of p.units) {
    const eid = await reg.endpoint(u.building, u.unit, service, 'psr');
    if (!eid) { res.unmatched.push({ building: u.building, unit: u.unit, service }); continue; }
    if (u.transmitterId) {
      const d = await upsertDevice(q, propertyId, 'transmitter', u.transmitterId);
      if (d.created) res.devices++;
      await ensureInstalled(q, propertyId, d.id, eid, u.installedOn, 'install_project');
    }
    await ensurePlaceholderMeter(q, propertyId, eid, u.installedOn, 'install_project', u.meterModel, u.meterId);
  }
}

/** Retention: raw import files are discarded 180 days after import; parsed readings and history stay. */
export async function purgeExpiredImports(db: Db, today?: string): Promise<number> {
  const r = await db.query(
    `UPDATE import_batch SET raw_file=NULL, raw_purged_at=now() WHERE raw_file IS NOT NULL AND purge_after <= COALESCE($1::date, current_date)`,
    [today ?? null]);
  return r.affectedRows ?? 0;
}
