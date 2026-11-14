// Where each flagged unit is in the work cycle, derived from the records (nothing stored, so it can never drift):
//   needs_document  flagged by the audit, not on any WA / Proposal / RFM yet
//   on_document     on a document, no visit since
//   visited         serviced after the document; waiting for the next audit to confirm
//   revisit         the last visit could not get access or could not finish
//   not_fixed       an audit taken wholly after the last visit still flags it
import type { Db } from '../db';
import { auditLines, needsAction, type AuditLine } from '../queries/audit';
import { LIVE_EVENT } from './record';
import { afterService, type AfterVerdict } from './verdict';

export type UnitStage = 'needs_document' | 'on_document' | 'visited' | 'revisit' | 'not_fixed';
export const STAGE_LABEL: Record<UnitStage, string> = {
  needs_document: 'Needs a WA', on_document: 'On a document', visited: 'Serviced, awaiting audit', revisit: 'Revisit needed', not_fixed: 'Still failing after service',
};

export interface StagedLine extends AuditLine {
  stage: UnitStage;
  doc: { id: string; number: string; type: string; createdOn: string; issued: boolean } | null;
  lastVisit: { visitId: string; visitedOn: string; result: string | null } | null;
}

const UNABLE = ['unable_to_access', 'unable_to_complete'];

/**
 * `verdict` is what this (flagged) audit line means for a unit serviced before the audit window (afterService):
 * a failed repair is not_fixed; anything else flagged after the visit is a new item, handled like any other line.
 */
export function stageOf(windowStart: string | null, doc: { createdOn: string } | null, ev: { visitedOn: string; result: string | null; outcome: string } | null, verdict: AfterVerdict = 'failing'): UnitStage {
  if (ev && doc && doc.createdOn > ev.visitedOn) return 'on_document';           // re-quoted after the visit
  if (ev && (UNABLE.includes(ev.result ?? '') || UNABLE.includes(ev.outcome))) return 'revisit';
  if (ev && windowStart && windowStart >= ev.visitedOn) return verdict === 'failing' ? 'not_fixed' : 'needs_document';
  if (ev) return 'visited';
  if (doc) return 'on_document';
  return 'needs_document';
}

/** Stage every unit that needs action in one audit batch. */
export async function stagedLines(db: Db, batchId: string, asOf: string): Promise<StagedLine[]> {
  const lines = needsAction(await auditLines(db, batchId, asOf));
  if (!lines.length) return [];
  const ids = lines.map((l) => l.endpointId);
  const evs = (await db.query<{ endpoint_id: string; visit_id: string; visited_on: string; result: string | null; outcome: string }>(
    `SELECT DISTINCT ON (se.endpoint_id) se.endpoint_id, v.id visit_id, v.visited_on::text, se.result, v.outcome
       FROM service_event se JOIN visit v ON v.id=se.visit_id
      WHERE se.endpoint_id = ANY($1) AND ${LIVE_EVENT}
      ORDER BY se.endpoint_id, v.visited_on DESC, se.created_at DESC`, [ids])).rows;
  const docs = (await db.query<{ endpoint_id: string; id: string; number: string; type: string; created_on: string; issued: boolean }>(
    `SELECT DISTINCT ON (dl.endpoint_id) dl.endpoint_id, d.id, d.number, d.type, d.created_on::text, (dv.status='issued') issued
       FROM document_line dl JOIN document_version dv ON dv.id=dl.version_id JOIN document d ON d.id=dv.document_id
      WHERE dl.endpoint_id = ANY($1) AND dl.include
        AND dv.version = (SELECT max(version) FROM document_version x WHERE x.document_id=d.id)
      ORDER BY dl.endpoint_id, d.created_on DESC, d.created_at DESC`, [ids])).rows;
  const ev = new Map(evs.map((e) => [e.endpoint_id, e]));
  const dc = new Map(docs.map((d) => [d.endpoint_id, d]));
  return lines.map((l) => {
    const e = ev.get(l.endpointId); const d = dc.get(l.endpointId);
    const windowStart = [l.readDate1, l.readDate2].filter((x): x is string => !!x).sort()[0] ?? null;
    const doc = d ? { id: d.id, number: d.number, type: d.type, createdOn: d.created_on, issued: d.issued } : null;
    const lastVisit = e ? { visitId: e.visit_id, visitedOn: e.visited_on, result: e.result } : null;
    return { ...l, stage: stageOf(windowStart, doc, e ? { visitedOn: e.visited_on, result: e.result, outcome: e.outcome } : null, afterService(l.recommendation)), doc, lastVisit };
  });
}

export async function latestAuditBatch(db: Pick<Db, 'query'>, propertyId: string) {
  return (await db.query<{ id: string; on: string }>(
    `SELECT id, imported_at::date::text "on" FROM import_batch WHERE property_id=$1 AND kind IN ('auto_audit','manual_audit') ORDER BY imported_at DESC, id DESC LIMIT 1`, [propertyId])).rows[0] ?? null;
}

export const countStages = (lines: StagedLine[]) => {
  const c: Record<UnitStage, number> = { needs_document: 0, on_document: 0, visited: 0, revisit: 0, not_fixed: 0 };
  for (const l of lines) c[l.stage]++;
  return c;
};
