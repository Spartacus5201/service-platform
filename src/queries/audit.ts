import type { Db } from '../db';
import { touchesFor, serviceInstalls, partDate } from '../service/coverage';
import { recommend, normalizeCode, type Recommendation, type AuditSettings, type RuleTable } from '../rules/audit';
import { coverage, type Coverage, type WarrantySettings } from '../rules/warranty';
import { readSettings } from '../settings';

export async function loadSettings(db: Pick<Db, 'query'>): Promise<{ audit: AuditSettings; warranty: WarrantySettings }> {
  const s = await readSettings(db);
  return {
    audit: { intReadThreshold: s.int_read_threshold, intStaleDays: s.int_stale_days },
    warranty: { installMonths: s.warranty_months_install, serviceMonths: s.warranty_months_service, expiringDays: s.expiring_window_days },
  };
}

export interface AuditLine {
  readingId: string;
  endpointId: string;
  building: string;
  unit: string;
  service: string;
  code: string;
  /** The code the rules judged it as: the code itself, or the built-in code an added audit code works like. */
  ruleCode: string;
  usage: number | null;
  readCount: number | null;
  occupied: boolean | null;
  isManual: boolean;
  address: string | null;
  moveInOn: string | null;
  readDate1: string | null;
  readDate2: string | null;
  transmitterId: string | null;
  miuid: string | null;
  /** What the reviewer settled on (the rules' answer unless overridden). Everything downstream uses this. */
  recommendation: Recommendation;
  /** What the rules alone said. */
  rules: Recommendation;
  override: { reason: string; by: string | null; at: string } | null;
  coverage: Coverage;
  /** The transmitter's latest check-in reports low battery: preventative maintenance. */
  lowBattery: { since: string; hardwareId: string | null; level: number | null; model: string | null } | null;
}

/** Every reading in an import batch with its recommendation and warranty position, ready for the audit review screen. */
export async function auditLines(db: Pick<Db, 'query'>, batchId: string, asOf: string, o: { rules?: RuleTable } = {}): Promise<AuditLine[]> {
  const { audit, warranty } = await loadSettings(db);
  // The rules in force, or a draft being tested (Admin > Rules).
  const ruleTable = o.rules ?? await (await import('../rules/table')).loadRules(db);
  const rows = await db.query<{
    id: string; endpoint_id: string; building: string; unit: string; service_code: string; audit_result: string;
    usage: string | null; read_count: number | null; last_real_on: string | null; read_date_2: string | null; move_in_on: string | null; occupancy_as_of: string | null; is_manual_read: boolean;
    installed_by_us: boolean; install_completed_on: string | null; address: string | null;
    read_date_1: string | null; amr_id: string | null; vendor_label: string | null;
  }>(
    `SELECT r.id, r.endpoint_id, b.label building, u.current_label unit, e.service_code, r.audit_result, r.usage::text, r.read_count, r.last_real_on::text, r.read_date_2::text,
            u.move_in_on::text, u.occupancy_as_of::text, e.is_manual_read, p.installed_by_us, p.install_completed_on::text, u.service_address address,
            r.read_date_1::text, r.amr_id, e.vendor_label
       FROM audit_reading r
       JOIN endpoint e ON e.id=r.endpoint_id JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id
       JOIN property p ON p.id=b.property_id
      WHERE r.import_batch_id=$1
      ORDER BY b.label, u.current_label, e.service_code`, [batchId]);

  const ovr = await db.query<{ reading_id: string; action: Recommendation['action']; owner: Recommendation['owner'] | null; component: Recommendation['component'] | null; reason: string; by: string | null; at: string }>(
    `SELECT o.reading_id, o.action, o.owner, o.component, o.reason, u.name by, o.created_at::text at
       FROM audit_override o LEFT JOIN app_user u ON u.id=o.user_id WHERE o.reading_id IN (SELECT id FROM audit_reading WHERE import_batch_id=$1)`, [batchId]);
  const overrides = new Map(ovr.rows.map((o) => [o.reading_id, o]));

  // Warranty inputs come from the same functions recording a visit uses, so quote and invoice agree.
  const epIds = [...new Set(rows.rows.map((r) => r.endpoint_id))];
  const byEndpoint = await touchesFor(db, epIds);
  const installs = await serviceInstalls(db, epIds);

  const { lowBatteryDevices } = await import('../service/battery');
  const low = new Map((await lowBatteryDevices(db, { endpointIds: [...new Set(rows.rows.map((r) => r.endpoint_id))] }))
    .filter((d) => d.endpointId).map((d) => [d.endpointId!, { since: d.firstLowOn, hardwareId: d.hardwareId, level: d.batteryLevel, model: d.model }]));

  const { loadLists } = await import('../lists/lists');
  const lists = await loadLists(db);
  return rows.rows.map((r) => {
    // Occupancy is unknown until an occupancy (or audit with ranges) import has run for the unit.
    const occupied = r.occupancy_as_of === null ? null : r.move_in_on !== null;
    const code = normalizeCode(r.audit_result);
    // An added audit code (Admin > Lists) has its own rule if one was saved, else the rule of the code it works like.
    // A retired added code is not recognised. ruleCode (for wording) is always the built-in code.
    const item = lists.get('audit_code', code);
    const retired = !!item && !item.builtin && !item.active;
    const ruleCode = lists.worksLike('audit_code', code) ?? code;
    const judgeAs = retired ? code : ruleTable[code] ? code : ruleCode;
    const rules = recommend({ code: judgeAs, occupied, isManualRead: r.is_manual_read, readCount: r.read_count, lastRealOn: r.last_real_on, auditEndOn: r.read_date_2 }, audit, retired ? {} : ruleTable);
    const o = overrides.get(r.id);
    const rec: Recommendation = o
      ? { action: o.action, ...(o.owner ? { owner: o.owner } : {}), ...(o.component ? { component: o.component } : {}), reason: `Reviewer: ${o.reason}` }
      : rules;
    const cov = coverage({
      installedByUs: r.installed_by_us, installCompletedOn: r.install_completed_on,
      endpointVisits: byEndpoint.get(r.endpoint_id) ?? [], visitDate: asOf, devicePartInstalledOn: partDate(installs.get(r.endpoint_id), rec.component, asOf),
    }, warranty);
    return {
      readingId: r.id, endpointId: r.endpoint_id, building: r.building, unit: r.unit, service: r.service_code, code, ruleCode,
      usage: r.usage === null ? null : Number(r.usage), readCount: r.read_count, occupied, isManual: r.is_manual_read,
      address: r.address, moveInOn: r.move_in_on, readDate1: r.read_date_1, readDate2: r.read_date_2, transmitterId: r.amr_id, miuid: r.vendor_label,
      recommendation: rec, rules, override: o ? { reason: o.reason, by: o.by, at: o.at } : null, coverage: cov,
      lowBattery: low.get(r.endpoint_id) ?? null,
    };
  });
}

/** Lines that need action, grouped the way the work authorization builder starts. */
export const needsAction = (lines: AuditLine[]) => lines.filter((l) => l.recommendation.action !== 'No action');
