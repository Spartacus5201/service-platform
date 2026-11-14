// "Own records" for people whose permission is limited to their own work (technicians by default):
// a visit is theirs if they did it (technician_id) or recorded it (created_by); a job is theirs if it has such a visit.
import type { Q } from '../db';

/** SQL condition: visit aliased `v` belongs to the user in parameter `param` (e.g. '$1'). */
export const ownVisit = (param: string, alias = 'v') => `(${alias}.technician_id = ${param} OR ${alias}.created_by = ${param})`;

export async function isOwnVisit(q: Q, visitId: string, userId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(visitId)) return false;
  return (await q.query(`SELECT 1 FROM visit v WHERE v.id=$1 AND ${ownVisit('$2')}`, [visitId, userId])).rows.length > 0;
}

export async function isOwnJob(q: Q, jobId: string, userId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return false;
  return (await q.query(`SELECT 1 FROM visit v WHERE v.job_id=$1 AND ${ownVisit('$2')}`, [jobId, userId])).rows.length > 0;
}

/** Job ids with at least one of the user's visits. */
export async function ownJobIds(q: Q, userId: string): Promise<string[]> {
  return (await q.query<{ job_id: string }>(`SELECT DISTINCT v.job_id FROM visit v WHERE v.job_id IS NOT NULL AND ${ownVisit('$1')}`, [userId])).rows.map((r) => r.job_id);
}
