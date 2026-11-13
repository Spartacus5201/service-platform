import { getDb } from '@/src/server/db';
import { requireSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { listProperties } from '@/src/server/queries';
import { createProperty } from './actions';
import { todayQueues } from '@/src/queries/today';
import { today } from '@/src/server/dates';
import { Today } from './today';
import { Badge, Flash, one, us, type SP } from './ui';

export default async function Home({ searchParams }: { searchParams: SP }) {
  const s = await requireSession();
  const sp = await searchParams;
  const db = await getDb();
  const pq = (one(sp.pq) ?? '').trim();
  const props = await listProperties(db, { q: pq });
  const todayStr = today();
  const showToday = can(s.role, 'edit_documents');
  const q = showToday ? await todayQueues(db, today()) : null;
  return (
    <>
      <h1>{q ? 'Home' : 'Properties'}</h1>
      <p className="sub">Pick a property to import reports, review an audit, or look up a unit.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      {q && <Today q={q} />}
      <h2>Properties</h2>
      <form method="get" role="search" className="row" style={{ alignItems: 'flex-end', marginBottom: '.5rem' }}>
        <div className="field"><label htmlFor="pq">Filter by name, ClassID or address</label><input id="pq" name="pq" defaultValue={pq} /></div>
        <div className="field"><button className="secondary" type="submit">Filter</button>{pq && <> <a href="/">Clear</a></>}</div>
      </form>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Property</th><th>ClassID</th><th>Installed by us</th><th className="n">Units</th><th>Last audit</th><th>Next audit due</th><th className="n">Documents</th></tr></thead>
          <tbody>
            {props.map((p) => (
              <tr key={p.id}>
                <td><a href={`/properties/${p.id}`}>{p.name}</a></td><td>{p.class_id}</td>
                <td>{p.installed_by_us ? <Badge tone="ok">Yes</Badge> : <Badge>No</Badge>}</td>
                <td className="n">{p.units}</td><td>{us(p.last_audit) || '—'}</td><td>{p.due ? (p.due < todayStr ? <Badge tone="warn">{us(p.due)} late</Badge> : us(p.due)) : '—'}</td><td className="n">{p.docs}</td>
              </tr>
            ))}
            {!props.length && <tr><td colSpan={7} className="small">{pq ? `No property matches “${pq}”.` : 'No properties yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {can(s.role, 'import_reports') && (
        <form action={createProperty} className="card" style={{ marginTop: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Add a property</h2>
          <div className="row">
            <div className="field"><label htmlFor="class_id">ClassID</label><input id="class_id" name="class_id" required placeholder="9900001" /></div>
            <div className="field" style={{ flex: 2 }}><label htmlFor="name">Name</label><input id="name" name="name" required /></div>
            <div className="field" style={{ flex: 2 }}><label htmlFor="address">Address</label><input id="address" name="address" /></div>
          </div>
          <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><input type="checkbox" name="installed_by_us" /> We installed this property (install warranty applies)</label>
          <div className="actions"><button type="submit">Add property</button></div>
        </form>
      )}
    </>
  );
}
