import type { Db } from '../db';
import { recommend, normalizeCode, type Recommendation, type AuditSettings } from '../rules/audit';
import { coverage, type Coverage, type WarrantySettings, DEFAULT_WARRANTY, type ServiceVisit } from '../rules/warranty';

export async function loadSettings(db: Db): Promise<{ audit: AuditSettings; warranty: WarrantySettings }> {
  const r = await db.query<{ key: string; value: unknown }>(`SELECT key, value FROM setting`);
  const s = Object.fromEntries(r.rows.map((x) => [x.key, Number(x.value)]));
  return {
    audit: { intReadThreshold: s.int_read_threshold ?? 5, intStaleDays: s.int_stale_days ?? 3 },
    warranty: {
      installMonths: s.warranty_months_install ?? DEFAULT_WARRANTY.installMonths,
      serviceMonths: s.warranty_months_service ?? DEFAULT_WARRANTY.serviceMonths,
      expiringDays: s.expiring_window_days ?? DEFAULT_WARRANTY.expiringDays,
    },
  };
}

export interface AuditLine {
  readingId: string;
  endpointId: string;
  building: string;
  unit: string;
  service: string;
  code: string;
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
  lowBattery: { since: string; hardwareId: string | null } | null;
}

/** Every reading in an import batch with its recommendation and warranty position, ready for the audit review screen. */
export async function auditLines(db: Db, batchId: string, asOf: string): Promise<AuditLine[]> {
  const { audit, warranty } = await loadSettings(db);
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

  const visits = await db.query<{ endpoint_id: string; visited_on: string; outcome: ServiceVisit['outcome'] }>(
    `SELECT DISTINCT se.endpoint_id, v.visited_on::text, v.outcome
       FROM service_event se JOIN visit v ON v.id=se.visit_id
      WHERE se.endpoint_id IN (SELECT endpoint_id FROM audit_reading WHERE import_batch_id=$1)
        AND NOT se.voided AND NOT EXISTS (SELECT 1 FROM service_event s2 WHERE s2.supersedes = se.id)`, [batchId]);
  const byEndpoint = new Map<string, ServiceVisit[]>();
  visits.rows.forEach((v) => byEndpoint.set(v.endpoint_id, [...(byEndpoint.get(v.endpoint_id) ?? []), { date: v.visited_on, outcome: v.outcome }]));

  const partInstalls = await db.query<{ endpoint_id: string; installed_on: string }>(
    `SELECT endpoint_id, max(installed_on)::text installed_on FROM installation
      WHERE origin='service' AND endpoint_id IN (SELECT endpoint_id FROM audit_reading WHERE import_batch_id=$1) GROUP BY endpoint_id`, [batchId]);
  const partOn = new Map(partInstalls.rows.map((x) => [x.endpoint_id, x.installed_on]));

  const { lowBatteryDevices } = await import('../service/battery');
  const low = new Map((await lowBatteryDevices(db, { endpointIds: [...new Set(rows.rows.map((r) => r.endpoint_id))] }))
    .filter((d) => d.endpointId).map((d) => [d.endpointId!, { since: d.firstLowOn, hardwareId: d.hardwareId }]));

  return rows.rows.map((r) => {
    // Occupancy is unknown until an occupancy (or audit with ranges) import has run for the unit.
    const occupied = r.occupancy_as_of === null ? null : r.move_in_on !== null;
    const code = normalizeCode(r.audit_result);
    const rules = recommend({ code, occupied, isManualRead: r.is_manual_read, readCount: r.read_count, lastRealOn: r.last_real_on, auditEndOn: r.read_date_2 }, audit);
    const o = overrides.get(r.id);
    const rec: Recommendation = o
      ? { action: o.action, ...(o.owner ? { owner: o.owner } : {}), ...(o.component ? { component: o.component } : {}), reason: `Reviewer: ${o.reason}` }
      : rules;
    const cov = coverage({
      installedByUs: r.installed_by_us, installCompletedOn: r.install_completed_on,
      endpointVisits: byEndpoint.get(r.endpoint_id) ?? [], visitDate: asOf, devicePartInstalledOn: partOn.get(r.endpoint_id) ?? null,
    }, warranty);
    return {
      readingId: r.id, endpointId: r.endpoint_id, building: r.building, unit: r.unit, service: r.service_code, code,
      usage: r.usage === null ? null : Number(r.usage), readCount: r.read_count, occupied, isManual: r.is_manual_read,
      address: r.address, moveInOn: r.move_in_on, readDate1: r.read_date_1, readDate2: r.read_date_2, transmitterId: r.amr_id, miuid: r.vendor_label,
      recommendation: rec, rules, override: o ? { reason: o.reason, by: o.by, at: o.at } : null, coverage: cov,
      lowBattery: low.get(r.endpoint_id) ?? null,
    };
  });
}

/** Lines that need action, grouped the way the work authorization builder starts. */
export const needsAction = (lines: AuditLine[]) => lines.filter((l) => l.recommendation.action !== 'No action');
