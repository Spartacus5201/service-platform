import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { today } from '@/src/server/dates';
import { catalogItems } from '@/src/server/queries';
import { saveCatalogItem, setSuggestDefaultAction } from '../server-actions/catalog';
import { CatalogImportForm } from './import-form';
import { Flash, money, one, type SP } from '../ui';

export default async function Catalog({ searchParams }: { searchParams: SP }) {
  await requireCan('price.edit');
  const sp = await searchParams;
  const all = await catalogItems(await getDb());
  const q = (one(sp.q) ?? '').trim().toLowerCase();
  const found = q ? all.filter((c) => q.split(/\s+/).every((t) => [c.name, c.part_type, c.vendor, c.part_number, c.notes].join(' ').toLowerCase().includes(t))) : all;
  const LIMIT = 150; const items = found.slice(0, LIMIT);
  return (
    <>
      <h1>Price catalog</h1>
      <p className="sub">Prices come from the master price list import or are added by hand. A price change is a new row with a later date; history stays.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <CatalogImportForm />
      <form className="card" method="get" style={{ marginTop: '1rem' }}>
        <div className="row"><div className="field" style={{ flex: 2 }}><label htmlFor="q">Find an item</label><input id="q" name="q" defaultValue={one(sp.q) ?? ''} placeholder="Part type, description, vendor or part number" /></div>
        <div className="actions" style={{ alignSelf: 'end' }}><button type="submit">Search</button></div></div>
        <p className="small" style={{ margin: 0 }}>{found.length} item{found.length === 1 ? '' : 's'}{found.length > LIMIT ? `, showing the first ${LIMIT}. Narrow the search to see the rest.` : ''}</p>
      </form>
      <div className="tablewrap"><table>
        <thead><tr><th>Item</th><th>Type</th><th>Vendor / part #</th><th>Component</th><th className="n">Price</th><th>Effective</th><th>Suggest on drafts</th></tr></thead>
        <tbody>
          {items.map((c) => <tr key={c.id}><td>{c.name}<div className="small">{c.description ?? c.notes}</div></td><td>{c.part_type ?? c.kind}</td><td className="small">{[c.vendor, c.part_number].filter(Boolean).join(' · ')}</td><td>{c.component ?? '—'}</td><td className="n">{money(c.price === null ? null : Number(c.price))}</td><td>{c.effective_from}</td>
            <td>{c.component && c.kind === 'part' ? (
              <form action={setSuggestDefaultAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="on" value={c.suggest_default ? '0' : '1'} />
                <button className="secondary" type="submit">{c.suggest_default ? 'Suggested ✓ (clear)' : 'Suggest'}</button></form>) : ''}</td></tr>)}
          {!items.length && <tr><td colSpan={7} className="small">No items found.</td></tr>}
        </tbody>
      </table></div>
      <form action={saveCatalogItem} className="card" style={{ marginTop: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Add an item or a new price</h2>
        <div className="row">
          <div className="field" style={{ flex: 2 }}><label htmlFor="name">Name</label><input id="name" name="name" required /></div>
          <div className="field"><label htmlFor="kind">Kind</label><select id="kind" name="kind"><option>part</option><option>labor</option></select></div>
          <div className="field"><label htmlFor="component">Component</label><select id="component" name="component" defaultValue=""><option value="">(any)</option><option>transmitter</option><option>meter</option><option>combo</option></select></div>
          <div className="field"><label htmlFor="unit">Unit</label><input id="unit" name="unit" defaultValue="each" /></div>
          <div className="field"><label htmlFor="price">Price</label><input id="price" className="num" name="price" inputMode="decimal" /></div>
          <div className="field"><label htmlFor="effective_from">Effective</label><input id="effective_from" name="effective_from" type="date" defaultValue={today()} /></div>
        </div>
        <div className="field"><label htmlFor="description">Description</label><input id="description" name="description" /></div>
        <div className="actions"><button type="submit">Add</button></div>
      </form>
    </>
  );
}
