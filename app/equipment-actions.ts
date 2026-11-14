'use server';
import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { saveModel, EquipmentError } from '@/src/equipment/registry';
import { withError, withMsg } from './ui';

const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() !== '' ? v.trim() : null; };
const list = (v: string | null) => (v ?? '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

export async function saveModelAction(fd: FormData) {
  const sess = await requireCan('edit_prices');
  const id = s(fd, 'id');
  let saved: string;
  try {
    const life = s(fd, 'battery_life_years');
    saved = await saveModel(await getDb(), sess.userId, {
      manufacturer: s(fd, 'manufacturer') ?? '', model: s(fd, 'model') ?? '', kind: s(fd, 'kind') ?? '', readingSystem: s(fd, 'reading_system'),
      services: fd.getAll('services').map(String), aliases: list(s(fd, 'aliases')), status: s(fd, 'status') ?? 'current', replacedBy: s(fd, 'replaced_by'),
      partItemId: s(fd, 'part_item_id'), batteryItemId: s(fd, 'battery_item_id'), batteryLifeYears: life ? Number(life) : null, notes: s(fd, 'notes'),
    }, id ?? undefined);
  } catch (e) {
    if (e instanceof EquipmentError) {
      const back = id ? `/equipment/${id}` : `/equipment/new?${new URLSearchParams({ model: s(fd, 'model') ?? '', kind: s(fd, 'kind') ?? '', manufacturer: s(fd, 'manufacturer') ?? '' })}`;
      redirect(withError(back, e.message));
    }
    throw e;
  }
  redirect(withMsg(`/equipment/${saved}`, id ? 'Saved. New documents use this from now on; issued documents keep what they were issued with.' : 'Added to the registry.'));
}
