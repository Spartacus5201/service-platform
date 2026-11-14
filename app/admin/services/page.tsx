import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { listServices } from '@/src/lists/services';
import { saveServiceAction } from '../../server-actions/lists';
import { Badge, Flash, one, type SP } from '../../ui';

export default async function Services({ searchParams }: { searchParams: SP }) {
  await requireCan('lists.edit');
  const sp = await searchParams; const db = await getDb();
  const list = await listServices(db, { includeRetired: true });
  const inUse = new Map((await db.query<{ service_code: string; n: string }>(`SELECT service_code, count(*) n FROM endpoint GROUP BY service_code`)).rows.map((r) => [r.service_code, Number(r.n)]));
  return (
    <>
      <h1>Service codes</h1>
      <p className="sub">The ServiceID codes the billing system uses, and the words other reports use for them. <a href="/admin">Back to Admin</a></p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <p className="small">A code cannot be renamed once added (units are filed under it). A report value is read as a service only when it matches the code, the name or one of the words exactly, ignoring capitals and punctuation. Retiring a code keeps it readable on old files. The import wizard uses this list; the built-in report readers use the standard codes.</p>
      <div className="tablewrap"><table>
        <thead><tr><th>Code</th><th>Name</th><th>Words in reports (comma separated)</th><th className="n">Order</th><th>Active</th><th className="n">Endpoints</th><th></th></tr></thead>
        <tbody>
          {list.map((x) => (
            <tr key={x.code} className={x.active ? '' : 'muted'}>
              <td colSpan={7} style={{ padding: 0 }}>
                <form action={saveServiceAction} style={{ display: 'grid', gridTemplateColumns: '5rem 1.2fr 2fr 4.5rem 4.5rem 5rem 5rem', gap: '.5rem', alignItems: 'center', padding: '.4rem .6rem' }}>
                  <input type="hidden" name="code" value={x.code} />
                  <b>{x.code}</b>
                  <input name="name" defaultValue={x.name} aria-label={`Name for ${x.code}`} />
                  <input name="words" defaultValue={x.words.join(', ')} aria-label={`Words for ${x.code}`} />
                  <input name="sort" className="num" defaultValue={x.sort} aria-label={`Order for ${x.code}`} />
                  <label><input type="checkbox" name="active" defaultChecked={x.active} /> {x.active ? <Badge tone="ok">yes</Badge> : <Badge>retired</Badge>}</label>
                  <span className="n">{inUse.get(x.code) ?? 0}</span>
                  <button className="secondary" type="submit">Save</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <form action={saveServiceAction} className="card" style={{ marginTop: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Add a service code</h2>
        <div className="row">
          <div className="field"><label htmlFor="code">Code</label><input id="code" name="code" required maxLength={6} placeholder="e.g. ST" /></div>
          <div className="field" style={{ flex: 2 }}><label htmlFor="name">Name</label><input id="name" name="name" required placeholder="e.g. Steam" /></div>
          <div className="field" style={{ flex: 3 }}><label htmlFor="words">Words in reports</label><input id="words" name="words" placeholder="e.g. steam, steam heat" /></div>
        </div>
        <input type="hidden" name="active" value="on" />
        <div className="actions"><button type="submit">Add</button></div>
      </form>
    </>
  );
}
