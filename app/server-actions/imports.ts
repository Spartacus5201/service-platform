'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { parseFile, ParseError } from '@/src/parsers';
import { importParsed, purgeExpiredImports } from '@/src/import/commit';
import { addUnitForIssue, dismissIssue, IssueError } from '@/src/import/issues';
import type { ImportUi } from '../types';
import { withError, withMsg } from '../ui';
import { listServices } from '@/src/lists/services';
import { s, msgOf, domainError } from './form';

// ---------- imports ----------
export async function importReport(_: ImportUi, fd: FormData): Promise<ImportUi> {
  const sess = await requireCan('import_reports');
  const propertyId = s(fd, 'property_id')!;
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose an .xlsx report or a Unit Directory .csv to import.' };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Files the built-in readers do not know (or a person wants to map by hand) go to the import wizard.
    const toWizard = async () => {
      const { createUpload } = await import('@/src/importer/wizard');
      const u = await createUpload(await getDb(), propertyId, file.name, bytes, sess.userId);
      return { wizardUrl: `/properties/${propertyId}/import/${u.id}` };
    };
    if (fd.get('wizard') === 'on') return await toWizard();
    let parsed;
    try { parsed = await parseFile(bytes, { services: await listServices(await getDb(), { includeRetired: true }) }); }
    catch (e) { if (e instanceof ParseError && (e.code === 'not_recognised' || e.code === 'needs_wizard')) return await toWizard(); throw e; }
    const asOccupancy = fd.get('purpose') === 'occupancy';
    await purgeExpiredImports(await getDb());     // retention is enforced whenever someone imports
    const r = await importParsed(await getDb(), propertyId, parsed, {
      createMissing: fd.get('create_missing') === 'on', as: asOccupancy ? 'occupancy' : undefined,
      importedBy: sess.userId, filename: file.name, fileBytes: bytes,
    });
    const isAudit = r.kind === 'auto_audit' || r.kind === 'manual_audit';
    return {
      kind: r.kind, duplicate: r.duplicate, rows: 'rows' in parsed ? parsed.rows.length : 'devices' in parsed ? parsed.devices.length : undefined,
      readings: r.readings, devices: r.devices, checkins: r.checkins, unitsCreated: r.unitsCreated, occupancyUpdated: r.occupancyUpdated,
      unmatched: r.unmatched, idChanges: r.idChanges, idElsewhere: r.idElsewhere, warnings: r.warnings.slice(0, 20),
      auditUrl: isAudit && r.batchId && !r.duplicate ? `/properties/${propertyId}/audits/${r.batchId}` : undefined,
    };
  } catch (e) {
    if (domainError(e)) return { error: msgOf(e) };
    console.error(e);
    return { error: 'That file could not be read. Check that it is an unmodified system report.' };
  }
}


// ---------- import problems ----------
export async function resolveIssueAction(fd: FormData) {
  const sess = await requireCan('import_reports');
  const id = s(fd, 'issue_id')!; const back = s(fd, 'back') ?? '/';
  const db = await getDb();
  try {
    if (fd.get('do') === 'add') await addUnitForIssue(db, id, sess.userId);
    else await dismissIssue(db, id, s(fd, 'reason'), sess.userId);
  } catch (e) { if (e instanceof IssueError) redirect(withError(back, e.message)); throw e; }
  redirect(withMsg(back, fd.get('do') === 'add' ? 'Unit added.' : 'Dismissed.'));
}
