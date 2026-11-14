'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { getPropertyPrices, parseEquipment, saveSystemNotes, type SystemNotes } from '@/src/documents/systemnotes';
import { withError, withMsg } from '../ui';
import { s, n, msgOf, domainError } from './form';
import { createProperty as addProperty, updateProperty as saveProperty } from '@/src/properties/property';

// ---------- properties ----------
export async function createProperty(fd: FormData) {
  const sess = await requireCan('property.edit');
  let id: string;
  try { id = await addProperty(await getDb(), sess.userId, { classId: s(fd, 'class_id'), name: s(fd, 'name'), address: s(fd, 'address'), installedByUs: fd.get('installed_by_us') === 'on' }); }
  catch (e) { if (domainError(e)) redirect(withError('/', msgOf(e))); throw e; }
  redirect(`/properties/${id}`);
}

export async function saveSystemNotesAction(fd: FormData) {
  const sess = await requireCan('property.edit');
  const id = s(fd, 'id')!; const db = await getDb();
  const utilities = [1, 2, 3].map((i) => ({ utility: s(fd, `utility_${i}`) ?? '', device: s(fd, `device_${i}`) ?? '' })).filter((u) => u.utility || u.device);
  const notes: SystemNotes = {
    utilities, systemBrand: s(fd, 'system_brand'), systemId: s(fd, 'system_id'), collectorLocation: s(fd, 'collector_location'),
    milestoneKind: s(fd, 'milestone_kind'), milestoneOn: s(fd, 'milestone_on'),
    techNote: s(fd, 'tech_note'), transmitterDevice: s(fd, 'transmitter_device'), meterDevice: s(fd, 'meter_device'), equipment: parseEquipment(s(fd, 'equipment') ?? ''),
  };
  // Price editors set property prices; anyone else saves the notes and leaves the prices as they were.
  const prices: Record<string, number> = can(sess, 'price.edit') ? {} : await getPropertyPrices(db, id);
  if (can(sess, 'price.edit')) for (const i of [1, 2, 3, 4, 5]) { const item = s(fd, `price_item_${i}`); const v = n(fd, `price_${i}`); if (item && v !== null) prices[item] = v; }
  try { await saveSystemNotes(db, id, notes, prices, fd.get('msa') === 'on', sess.userId); }
  catch (e) { if (domainError(e)) redirect(withError(`/properties/${id}?tab=settings`, msgOf(e))); throw e; }
  revalidatePath(`/properties/${id}`);
  redirect(withMsg(`/properties/${id}?tab=settings`, 'WA Notes saved.'));
}

export async function updateProperty(fd: FormData) {
  const sess = await requireCan('property.edit');
  const id = s(fd, 'id')!;
  try {
    await saveProperty(await getDb(), sess.userId, id, {
      name: s(fd, 'name'), address: s(fd, 'address'), billingCode: s(fd, 'billing_code'), installedByUs: fd.get('installed_by_us') === 'on', installCompletedOn: s(fd, 'install_completed_on'),
      salesforceAccountRef: s(fd, 'salesforce_account_ref'), accessNotes: s(fd, 'access_notes'), schedulingNotes: s(fd, 'scheduling_notes'), billingContract: fd.get('billing_contract') === 'on',
      city: s(fd, 'city'), state: s(fd, 'state'), zip: s(fd, 'zip'),
    });
  } catch (e) { if (domainError(e)) redirect(withError(`/properties/${id}?tab=settings`, msgOf(e))); throw e; }
  redirect(withMsg(`/properties/${id}?tab=settings`, 'Property saved.'));
}
