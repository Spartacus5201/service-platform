'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { today } from '@/src/server/dates';
import { requireCan } from '@/src/server/session';
import { importInventory } from '@/src/catalog/import';
import type { CatalogImportUi } from '../types';
import { withError, withMsg } from '../ui';
import { s, n, msgOf, domainError } from './form';

// ---------- catalog and clauses ----------
export async function saveCatalogItem(fd: FormData) {
  await requireCan('edit_prices');
  const name = s(fd, 'name'); if (!name) redirect(withError('/catalog', 'A name is required.'));
  await (await getDb()).query(
    `INSERT INTO catalog_item (name,description,kind,component,unit,price,effective_from) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [name, s(fd, 'description'), s(fd, 'kind') ?? 'part', s(fd, 'component'), s(fd, 'unit') ?? 'each', n(fd, 'price'), s(fd, 'effective_from') ?? today()]);
  redirect(withMsg('/catalog', 'Item added. A new row with a later date supersedes the old price.'));
}

export async function importCatalogAction(_: CatalogImportUi, fd: FormData): Promise<CatalogImportUi> {
  const sess = await requireCan('edit_prices');
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose the price list (.xlsx) first.' };
  const apply = s(fd, 'intent') === 'apply';
  try {
    const db = await getDb();
    const r = await importInventory(db, new Uint8Array(await file.arrayBuffer()), today(), apply);
    if (apply) await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'catalog_import','catalog',$2,$3)`,
      [sess.userId, file.name, JSON.stringify({ added: r.added, changed: r.changed, unchanged: r.unchanged })]);
    return {
      applied: apply, summary: { rows: r.rows, added: r.added, changed: r.changed, unchanged: r.unchanged, skippedNoPrice: r.skippedNoPrice, obsolete: r.obsolete },
      changes: r.changes.slice(0, 50).map((c) => ({ name: c.name, from: c.from, to: c.to })), addedSample: r.addedNames.slice(0, 10),
    };
  } catch (e) {
    if (domainError(e)) return { error: msgOf(e) };
    console.error(e); return { error: 'That file could not be read. Save the price list as .xlsx and try again.' };
  }
}

/** Mark one catalog item as the part suggested on new drafts for its component (one per component). */
export async function setSuggestDefaultAction(fd: FormData) {
  await requireCan('edit_prices');
  const id = s(fd, 'id')!; const on = fd.get('on') === '1';
  const db = await getDb();
  await db.transaction(async (tx) => {
    const row = (await tx.query<{ component: string | null; name: string; part_type: string | null; part_number: string | null }>(`SELECT component,name,part_type,part_number FROM catalog_item WHERE id=$1`, [id])).rows[0];
    if (!row?.component) return;
    await tx.query(`UPDATE catalog_item SET suggest_default=false WHERE component=$1`, [row.component]);
    if (on) await tx.query(`UPDATE catalog_item SET suggest_default=true WHERE lower(name)=lower($1) AND coalesce(part_type,'')=coalesce($2,'') AND coalesce(part_number,'')=coalesce($3,'')`, [row.name, row.part_type, row.part_number]);
  });
  redirect(withMsg('/catalog', on ? 'Suggested part set.' : 'Suggestion cleared.'));
}

export async function saveClause(fd: FormData) {
  await requireCan('edit_documents');
  const key = s(fd, 'key'); const title = s(fd, 'title'); const body = s(fd, 'body');
  if (!key || !title || !body) redirect(withError('/clauses', 'Key, title, and text are required.'));
  const types = fd.getAll('types').map(String).filter((t) => ['WA', 'Proposal', 'RFM'].includes(t));
  const audience = s(fd, 'audience');
  const db = await getDb();
  const v = (await db.query<{ v: number | null }>(`SELECT max(version) v FROM clause_template WHERE key=$1`, [key])).rows[0].v ?? 0;
  await db.query(`INSERT INTO clause_template (key,title,body,applies_when,version) VALUES ($1,$2,$3,$4,$5)`,
    [key, title, body, JSON.stringify({ ...(types.length ? { types } : {}), ...(audience ? { audience } : {}) }), v + 1]);
  redirect(withMsg('/clauses', v ? `Clause "${key}" saved as version ${v + 1}.` : 'Clause added.'));
}
