'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { today } from '@/src/server/dates';
import { requireCan } from '@/src/server/session';
import { auditLines } from '@/src/queries/audit';
import { setOverride, clearOverride, ReviewError, type OverrideInput } from '@/src/review/overrides';
import { s, msgOf, isRedirect, domainError } from './form';

// ---------- audit review ----------
export async function overrideAction(fd: FormData) {
  const sess = await requireCan('edit_documents');
  const propertyId = s(fd, 'property_id')!; const batchId = s(fd, 'batch_id')!; const readingId = s(fd, 'reading_id')!;
  const back = (extra: string) => `/properties/${propertyId}/audits/${batchId}${s(fd, 'show') === 'all' ? '?show=all&' : '?'}${extra}`;
  const db = await getDb();
  try {
    if (s(fd, 'intent') === 'clear') { await clearOverride(db, readingId, sess.userId); redirect(back('msg=' + encodeURIComponent('Back to the rules\' answer.'))); }
    const line = (await auditLines(db, batchId, today())).find((l) => l.readingId === readingId);
    if (!line) throw new ReviewError('That reading is not in this audit.');
    const r = await setOverride(db, readingId, { action: s(fd, 'action') as OverrideInput['action'], owner: s(fd, 'owner'), component: s(fd, 'component'), reason: s(fd, 'reason') ?? '' }, sess.userId, line.rules);
    redirect(back('msg=' + encodeURIComponent(r === 'saved' ? `Saved: ${line.building}-${line.unit} ${line.service}.` : 'That matches the rules, so the correction was removed.')));
  } catch (e) { if (isRedirect(e)) throw e; if (domainError(e)) redirect(back('error=' + encodeURIComponent(msgOf(e)))); throw e; }
}
