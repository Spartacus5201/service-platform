import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { LIST_DEFS, listDef, loadLists } from '@/src/lists/lists';
import { restoreListItemAction, saveListItemAction } from '../../server-actions/lists';
import { Badge, Flash, one, type SP } from '../../ui';

const KIND_TEXT = {
  fixed: 'Rename, reword and reorder. Items cannot be added: the workflow depends on each one.',
  works_like: 'Items can be added. Each added item works like a built-in item, so every rule and report keeps working.',
  free: 'Add, rename, reorder and retire freely.',
} as const;

export default async function ListsPage({ searchParams }: { searchParams: SP }) {
  await requireCan('lists.edit');
  const sp = await searchParams; const db = await getDb();
  const def = listDef(one(sp.list) ?? '') ?? LIST_DEFS[0];
  const lists = await loadLists(db);
  const items = lists.items(def.key, { includeRetired: true });
  const changed = new Set((await db.query<{ code: string }>(`SELECT code FROM list_item WHERE list=$1`, [def.key])).rows.map((r) => r.code));
  const builtinLabel = (c: string) => def.builtins.find((b) => b.code === c)?.label ?? c;
  const likeOf = def.worksLikeOf ?? def.builtins.map((b) => b.code);
  const cols = `6rem 1.2fr ${def.wording ? '2fr ' : ''}${def.kind === 'works_like' ? '9rem ' : ''}4.5rem 7rem 9rem`;
  return (
    <>
      <h1>Lists</h1>
      <p className="sub">The codes and words offered in forms and printed on documents. <a href="/admin">Back to Admin</a> · <a href="/admin/services">Service codes</a></p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <p className="small">{LIST_DEFS.map((d, i) => <span key={d.key}>{i > 0 && ' · '}{d.key === def.key ? <b>{d.name}</b> : <a href={`/admin/lists?list=${d.key}`}>{d.name}</a>}</span>)}</p>
      <h2>{def.name}</h2>
      <p className="small">{def.hint} {KIND_TEXT[def.kind]} Nothing is deleted: a retired item stays readable on old records and is no longer offered. Every change is in the activity log.</p>
      {def.wording && <p className="small"><b>Wording:</b> {def.wording}.</p>}
      <div className="tablewrap"><table>
        <thead><tr><td colSpan={9} style={{ padding: 0 }}><div style={{ display: 'grid', gridTemplateColumns: cols, gap: '.5rem', padding: '.4rem .6rem', fontWeight: 600 }}>
          <span>Code</span><span>Name</span>{def.wording && <span>Wording</span>}{def.kind === 'works_like' && <span>Works like</span>}<span>Order</span><span>Active</span><span></span>
        </div></td></tr></thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.code} className={x.active ? '' : 'muted'} data-code={x.code}>
              <td colSpan={9} style={{ padding: 0 }}>
                <form action={saveListItemAction} style={{ display: 'grid', gridTemplateColumns: cols, gap: '.5rem', alignItems: 'center', padding: '.4rem .6rem' }}>
                  <input type="hidden" name="list" value={def.key} /><input type="hidden" name="code" value={x.code} />
                  <span><b>{x.code}</b>{x.builtin && <div className="small">built-in</div>}</span>
                  <input name="label" defaultValue={x.label} aria-label={`Name for ${x.code}`} required />
                  {def.wording && <textarea name="wording" rows={2} defaultValue={x.wording ?? ''} aria-label={`Wording for ${x.code}`} />}
                  {def.kind === 'works_like' && (x.builtin ? <span className="small">itself</span>
                    : <select name="works_like" defaultValue={x.worksLike ?? ''} aria-label={`Works like for ${x.code}`}>{likeOf.map((c) => <option key={c} value={c}>{builtinLabel(c)}</option>)}</select>)}
                  <input name="sort" className="num" style={{ width: '100%', minWidth: 0 }} defaultValue={x.sort} aria-label={`Order for ${x.code}`} />
                  {x.builtin && !def.retireBuiltins ? <span className="small"><input type="hidden" name="active" value="on" /><Badge tone="ok">always</Badge></span>
                    : <label><input type="checkbox" name="active" defaultChecked={x.active} /> {x.active ? <Badge tone="ok">yes</Badge> : <Badge>retired</Badge>}</label>}
                  <span>
                    <button className="secondary" type="submit">Save</button>
                    {x.builtin && changed.has(x.code) && <> <button className="secondary" type="submit" formAction={restoreListItemAction} title="Put this item back as shipped">Restore</button></>}
                  </span>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {def.kind !== 'fixed' && (
        <form action={saveListItemAction} className="card" style={{ marginTop: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Add to {def.name.toLowerCase()}</h2>
          <input type="hidden" name="list" value={def.key} /><input type="hidden" name="active" value="on" />
          <div className="row">
            {def.code === 'upper' && <div className="field"><label htmlFor="new_code">Code (as the report writes it)</label><input id="new_code" name="new_code" required maxLength={12} placeholder="e.g. NR" /></div>}
            <div className="field" style={{ flex: 2 }}><label htmlFor="new_label">Name</label><input id="new_label" name="label" required /></div>
            {def.wording && <div className="field" style={{ flex: 3 }}><label htmlFor="new_wording">Wording</label><input id="new_wording" name="wording" /></div>}
            {def.kind === 'works_like' && <div className="field"><label htmlFor="new_like">Works like</label><select id="new_like" name="works_like" required defaultValue="">
              <option value="" disabled>Choose…</option>{likeOf.map((c) => <option key={c} value={c}>{builtinLabel(c)}</option>)}</select></div>}
          </div>
          <div className="actions"><button type="submit">Add</button></div>
        </form>
      )}
    </>
  );
}
