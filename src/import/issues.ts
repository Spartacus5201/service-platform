// Import problems that need a person, kept until they are dealt with:
//   unmatched_unit  a unit in the file is not in the registry (it was skipped)
//   id_mismatch     the file's transmitter ID differs from the one on record (the record was not changed)
// Re-checked after every import: an issue resolves itself once the records catch up.
import type { Db } from '../db';
import { normLabel } from '../parsers/common';
import { Registry } from './commit';

type Q = Pick<Db, 'query'>;
export class IssueError extends Error {}

export interface ImportIssue {
  id: string; propertyId: string; batchId: string | null; kind: 'unmatched_unit' | 'id_mismatch';
  building: string; unit: string; service: string; was: string | null; now: string | null; createdOn: string; filename: string | null;
}

export async function recordIssues(q: Q, propertyId: string, batchId: string,
  found: { unmatched: { building: string; unit: string; service: string }[]; idChanges: { building: string; unit: string; was: string; now: string }[] }): Promise<void> {
  const open = (await q.query<{ kind: string; building: string; unit: string; service: string; now: string | null }>(
    `SELECT kind, building, unit, service, now FROM import_issue WHERE property_id=$1 AND status='open'`, [propertyId])).rows;
  const key = (k: string, b: string, u: string, s: string, n: string | null) => [k, normLabel(b), normLabel(u), s, n ?? ''].join('|');
  const have = new Set(open.map((o) => key(o.kind, o.building, o.unit, o.service, o.now)));
  const add = async (kind: string, b: string, u: string, s: string, was: string | null, now: string | null) => {
    const k = key(kind, b, u, s, now); if (have.has(k)) return; have.add(k);
    await q.query(`INSERT INTO import_issue (property_id,import_batch_id,kind,building,unit,service,was,now) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [propertyId, batchId, kind, b, u, s, was, now]);
  };
  for (const x of found.unmatched) await add('unmatched_unit', x.building, x.unit, x.service ?? '', null, null);
  for (const x of found.idChanges) await add('id_mismatch', x.building, x.unit, '', x.was, x.now);
}

async function endpointFor(q: Q, propertyId: string, building: string, unit: string, service: string) {
  return (await q.query<{ unit_id: string; endpoint_id: string | null }>(
    `SELECT a.unit_id, (SELECT e.id FROM endpoint e WHERE e.unit_id=a.unit_id AND ($4 = '' OR e.service_code=$4) ORDER BY e.service_code LIMIT 1) endpoint_id
       FROM unit_alias a WHERE a.property_id=$1 AND a.building_label=$2 AND a.unit_label=$3 LIMIT 1`,
    [propertyId, normLabel(building), normLabel(unit), service])).rows[0] ?? null;
}

/** Close open issues the records have caught up with. Returns how many were resolved. */
export async function autoResolve(q: Q, propertyId: string): Promise<number> {
  const open = (await q.query<{ id: string; kind: string; building: string; unit: string; service: string; now: string | null }>(
    `SELECT id, kind, building, unit, service, now FROM import_issue WHERE property_id=$1 AND status='open'`, [propertyId])).rows;
  let n = 0;
  for (const i of open) {
    const ep = await endpointFor(q, propertyId, i.building, i.unit, i.service);
    let note: string | null = null;
    if (i.kind === 'unmatched_unit' && ep && (i.service === '' || ep.endpoint_id)) note = 'The unit is now on file.';
    if (i.kind === 'id_mismatch' && ep?.endpoint_id && i.now) {
      const cur = (await q.query<{ hardware_id: string }>(
        `SELECT d.hardware_id FROM installation x JOIN device d ON d.id=x.device_id WHERE x.endpoint_id=$1 AND x.removed_on IS NULL AND d.status='active' AND d.kind IN ('transmitter','combo')`, [ep.endpoint_id])).rows;
      if (cur.some((c) => c.hardware_id === i.now)) note = 'The record now has this ID (swap recorded).';
    }
    if (note) { await q.query(`UPDATE import_issue SET status='resolved', note=$2, resolved_at=now() WHERE id=$1`, [i.id, note]); n++; }
  }
  return n;
}

export async function openIssues(q: Q, propertyId?: string): Promise<ImportIssue[]> {
  return (await q.query<{ id: string; property_id: string; import_batch_id: string | null; kind: ImportIssue['kind']; building: string; unit: string; service: string; was: string | null; now: string | null; created_on: string; filename: string | null }>(
    `SELECT i.id, i.property_id, i.import_batch_id, i.kind, i.building, i.unit, i.service, i.was, i.now, i.created_at::date::text created_on, b.filename
       FROM import_issue i LEFT JOIN import_batch b ON b.id=i.import_batch_id
      WHERE i.status='open' ${propertyId ? 'AND i.property_id=$1' : ''} ORDER BY i.kind, i.building, i.unit`, propertyId ? [propertyId] : [])).rows
    .map((r) => ({ id: r.id, propertyId: r.property_id, batchId: r.import_batch_id, kind: r.kind, building: r.building, unit: r.unit, service: r.service, was: r.was, now: r.now, createdOn: r.created_on, filename: r.filename }));
}

/** Add a missing unit (and its endpoint for the service) to the registry, then resolve the issue. */
export async function addUnitForIssue(db: Db, issueId: string, userId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const i = (await tx.query<{ property_id: string; kind: string; building: string; unit: string; service: string; status: string }>(`SELECT property_id, kind, building, unit, service, status FROM import_issue WHERE id=$1`, [issueId])).rows[0];
    if (!i || i.status !== 'open') throw new IssueError('That problem is already dealt with.');
    if (i.kind !== 'unmatched_unit') throw new IssueError('Only a missing unit can be added.');
    const reg = new Registry(tx, i.property_id, true); await reg.load();
    if (i.service) await reg.endpoint(i.building, i.unit, i.service, 'manual'); else await reg.unit(i.building, i.unit, 'manual');
    await tx.query(`UPDATE import_issue SET status='resolved', note='Unit added by hand.', resolved_at=now(), resolved_by=$2 WHERE id=$1`, [issueId, userId]);
  });
}

export async function dismissIssue(q: Q, issueId: string, reason: string | null, userId: string | null): Promise<void> {
  if (!reason?.trim()) throw new IssueError('Say why this can be ignored (e.g. common area meter, unit no longer exists).');
  await q.query(`UPDATE import_issue SET status='dismissed', note=$2, resolved_at=now(), resolved_by=$3 WHERE id=$1 AND status='open'`, [issueId, reason.trim(), userId]);
}
