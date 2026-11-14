import type { Db } from '../db';
import { LIVE_EVENT } from './record';
import { touchesFor } from './coverage';
import { coverage, type Coverage } from '../rules/warranty';
import { loadSettings } from '../queries/audit';

export interface HistoryEntry {
  date: string;                           // ISO date
  type: 'service' | 'reading' | 'install' | 'document';
  href?: string;
  job?: { id: string; number: number } | null;
  summary: string;
  detail: Record<string, unknown>;
}

export interface EndpointHistory {
  endpoint: { id: string; building: string; unit: string; service: string; isManual: boolean; propertyId: string };
  devices: { id: string; kind: string; hardwareId: string | null; serial: string | null; model: string | null; placeholder: boolean; installedOn: string | null; origin: string; removedOn: string | null }[];
  timeline: HistoryEntry[];               // newest first
  coverage: Coverage;                     // warranty position as of `asOf`
}

/** Everything that happened at one endpoint: visits and parts, audit readings, installs. */
export async function endpointHistory(db: Db, endpointId: string, asOf: string): Promise<EndpointHistory> {
  const ep = await db.query<{ id: string; building: string; unit: string; service_code: string; is_manual_read: boolean; property_id: string; installed_by_us: boolean; install_completed_on: string | null }>(
    `SELECT e.id, b.label building, u.current_label unit, e.service_code, e.is_manual_read, b.property_id, p.installed_by_us, p.install_completed_on::text
       FROM endpoint e JOIN unit u ON u.id=e.unit_id JOIN building b ON b.id=u.building_id JOIN property p ON p.id=b.property_id WHERE e.id=$1`, [endpointId]);
  const e = ep.rows[0];
  if (!e) throw new Error('Unknown endpoint.');

  const events = await db.query<{ id: string; visited_on: string; outcome: string; technician: string | null; action: string; issue_code: string | null; read_at_service: string | null;
    notes: string | null; salesforce_case: string | null; salesforce_work_order: string | null; labor_covered: boolean; part_covered: boolean; coverage_basis: string[]; supersedes: string | null; visit_id: string; job_id: string | null; job_number: number | null }>(
    `SELECT se.id, v.id visit_id, v.job_id, (SELECT j.number FROM job j WHERE j.id=v.job_id) job_number, v.visited_on::text, v.outcome, v.technician, se.action, se.issue_code, se.read_at_service::text, se.notes,
            v.salesforce_case, v.salesforce_work_order, se.labor_covered, se.part_covered, se.coverage_basis, se.supersedes
       FROM service_event se JOIN visit v ON v.id=se.visit_id WHERE se.endpoint_id=$1 AND ${LIVE_EVENT} ORDER BY v.visited_on DESC, se.created_at DESC`, [endpointId]);
  const parts = await db.query<{ service_event_id: string; kind: string; old_hw: string | null; new_hw: string | null; new_serial: string | null; model: string | null; quantity: string }>(
    `SELECT ep.service_event_id, nd.kind, od.hardware_id old_hw, nd.hardware_id new_hw, nd.serial_number new_serial, nd.model, ep.quantity::text
       FROM event_part ep LEFT JOIN device od ON od.id=ep.old_device_id JOIN device nd ON nd.id=ep.new_device_id
      WHERE ep.service_event_id = ANY($1::uuid[])`, [events.rows.map((x) => x.id)]);
  const partsBy = new Map<string, typeof parts.rows>();
  parts.rows.forEach((p) => partsBy.set(p.service_event_id, [...(partsBy.get(p.service_event_id) ?? []), p]));

  const readings = await db.query<{ date: string; audit_result: string; usage: string | null; read_1: string | null; read_count: number | null }>(
    `SELECT COALESCE(r.read_date_1, b.imported_at::date)::text date, r.audit_result, r.usage::text, r.read_1::text, r.read_count
       FROM audit_reading r JOIN import_batch b ON b.id=r.import_batch_id WHERE r.endpoint_id=$1 ORDER BY 1 DESC`, [endpointId]);

  const devices = await db.query<{ id: string; kind: string; hardware_id: string | null; serial_number: string | null; model: string | null; is_placeholder: boolean; installed_on: string | null; origin: string; removed_on: string | null }>(
    `SELECT d.id, d.kind, d.hardware_id, d.serial_number, d.model, d.is_placeholder, i.installed_on::text, i.origin, i.removed_on::text
       FROM installation i JOIN device d ON d.id=i.device_id WHERE i.endpoint_id=$1 ORDER BY i.installed_on DESC NULLS LAST`, [endpointId]);

  const timeline: HistoryEntry[] = [];
  for (const x of events.rows) {
    const p = partsBy.get(x.id) ?? [];
    const partText = p.map((q) => `${q.kind} ${q.old_hw ?? 'unknown'} -> ${q.new_hw ?? q.new_serial ?? 'new'}`).join('; ');
    timeline.push({
      date: x.visited_on, type: 'service',
      summary: `${x.action.replace('_', '/')}${x.issue_code ? ` (${x.issue_code})` : ''}${x.outcome !== 'completed' ? ` — ${x.outcome.replace(/_/g, ' ')}` : ''}${partText ? `: ${partText}` : ''}`,
      detail: { ...x, parts: p }, href: `/visits/${x.visit_id}`, job: x.job_id ? { id: x.job_id, number: x.job_number! } : null,
    });
  }
  for (const r of readings.rows) timeline.push({ date: r.date, type: 'reading', summary: `Audit ${r.audit_result}${r.usage ? `, usage ${r.usage}` : ''}`, detail: { ...r } });
  for (const d of devices.rows) {
    if (d.origin === 'install_project' && d.installed_on) timeline.push({ date: d.installed_on, type: 'install', summary: `Installed ${d.kind}${d.hardware_id ? ` ${d.hardware_id}` : ''} (install project)`, detail: { ...d } });
  }
  const docs = await db.query<{ id: string; type: string; number: string; created_on: string; job_id: string | null; job_number: number | null; description: string }>(
    `SELECT DISTINCT ON (d.id) d.id, d.type, d.number, d.created_on::text, d.job_id, (SELECT j.number FROM job j WHERE j.id=d.job_id) job_number, dl.description
       FROM document_line dl JOIN document_version dv ON dv.id=dl.version_id JOIN document d ON d.id=dv.document_id
      WHERE dl.endpoint_id=$1 AND dl.include ORDER BY d.id, dv.version DESC`, [endpointId]);
  for (const d of docs.rows) timeline.push({ date: d.created_on, type: 'document', summary: `${d.type} ${d.number}: ${d.description}`, detail: { ...d }, href: `/documents/${d.id}`, job: d.job_id ? { id: d.job_id, number: d.job_number! } : null });
  timeline.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const { warranty } = await loadSettings(db);
  const currentPartInstall = devices.rows.filter((d) => d.origin === 'service' && d.removed_on === null).map((d) => d.installed_on).filter(Boolean).sort().pop() ?? null;
  const cov = coverage({
    installedByUs: e.installed_by_us, installCompletedOn: e.install_completed_on,
    endpointVisits: (await touchesFor(db, [endpointId])).get(endpointId) ?? [], visitDate: asOf, devicePartInstalledOn: currentPartInstall,
  }, warranty);
  // coverage() ignores visits on asOf itself; fine for "as of today" on a day without a visit.
  return {
    endpoint: { id: e.id, building: e.building, unit: e.unit, service: e.service_code, isManual: e.is_manual_read, propertyId: e.property_id },
    devices: devices.rows.map((d) => ({ id: d.id, kind: d.kind, hardwareId: d.hardware_id, serial: d.serial_number, model: d.model, placeholder: d.is_placeholder, installedOn: d.installed_on, origin: d.origin, removedOn: d.removed_on })),
    timeline, coverage: cov,
  };
}
