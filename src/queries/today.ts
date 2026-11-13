// "Today": everything that is waiting on someone, across all properties. Each queue is a plain query so it is easy to change.
import type { Db } from '../db';
import { auditLines, needsAction } from './audit';
import { followUps } from '../service/verify';
import { LIVE_EVENT } from '../service/record';

export interface Queues {
  units: { propertyId: string; property: string; batchId: string; count: number; auditedOn: string }[];
  draftNotes: { visitId: string; propertyId: string; property: string; visitedOn: string; units: number }[];
  idUpdates: { visitId: string; propertyId: string; property: string; visitedOn: string; rows: number }[];
  uninvoiced: { visitId: string; propertyId: string; property: string; visitedOn: string; units: number }[];
  failed: { propertyId: string; property: string; visitId: string; unit: string; service: string; evidence: string }[];
}

export async function todayQueues(db: Db, today: string): Promise<Queues> {
  const props = (await db.query<{ id: string; name: string }>(`SELECT id, name FROM property ORDER BY name`)).rows;
  const q: Queues = { units: [], draftNotes: [], idUpdates: [], uninvoiced: [], failed: [] };
  for (const p of props) {
    const b = (await db.query<{ id: string; on: string }>(
      `SELECT id, imported_at::date::text "on" FROM import_batch WHERE property_id=$1 AND kind IN ('auto_audit','manual_audit') ORDER BY imported_at DESC, id DESC LIMIT 1`, [p.id])).rows[0];
    if (b) {
      const count = needsAction(await auditLines(db, b.id, today)).length;
      if (count) q.units.push({ propertyId: p.id, property: p.name, batchId: b.id, count, auditedOn: b.on });
    }
    for (const f of await followUps(db, p.id)) q.failed.push({ propertyId: p.id, property: p.name, visitId: f.visitId, unit: `${f.building} ${f.unit}`, service: f.service, evidence: f.evidence });
  }
  const visits = (await db.query<{ id: string; pid: string; name: string; on: string; n: string }>(
    `SELECT v.id, p.id pid, p.name, v.visited_on::text "on", (SELECT count(*) FROM service_event se WHERE se.visit_id=v.id AND ${LIVE_EVENT}) n
       FROM visit v JOIN property p ON p.id=v.property_id WHERE v.notes_status='draft' ORDER BY v.visited_on`)).rows;
  q.draftNotes = visits.filter((v) => Number(v.n) > 0).map((v) => ({ visitId: v.id, propertyId: v.pid, property: v.name, visitedOn: v.on, units: Number(v.n) }));
  q.idUpdates = (await db.query<{ id: string; pid: string; name: string; on: string; n: string }>(
    `SELECT v.id, p.id pid, p.name, v.visited_on::text "on", count(*) n FROM id_update i JOIN visit v ON v.id=i.visit_id JOIN property p ON p.id=v.property_id
      WHERE i.status='pending' GROUP BY v.id, p.id, p.name, v.visited_on ORDER BY v.visited_on`)).rows
    .map((r) => ({ visitId: r.id, propertyId: r.pid, property: r.name, visitedOn: r.on, rows: Number(r.n) }));
  q.uninvoiced = (await db.query<{ id: string; pid: string; name: string; on: string; n: string }>(
    `SELECT v.id, p.id pid, p.name, v.visited_on::text "on", count(*) n FROM visit v JOIN property p ON p.id=v.property_id JOIN service_event se ON se.visit_id=v.id
      WHERE v.notes_status='approved' AND ${LIVE_EVENT}
        AND NOT EXISTS (SELECT 1 FROM invoice_line il WHERE il.service_event_id=se.id)
      GROUP BY v.id, p.id, p.name, v.visited_on ORDER BY v.visited_on`)).rows
    .map((r) => ({ visitId: r.id, propertyId: r.pid, property: r.name, visitedOn: r.on, units: Number(r.n) }));
  return q;
}
