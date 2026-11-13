import { getDb } from '@/src/server/db';
import { requireSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { listProperties } from '@/src/server/queries';
import { createProperty } from './actions';
import { Badge, Flash, one, type SP } from './ui';

export default async function Home({ searchParams }: { searchParams: SP }) {
  const s = await requireSession();
  const sp = await searchParams;
  const props = await listProperties(await getDb());
  return (
    <>
      <h1>Properties</h1>
      <p className="sub">Pick a property to import reports, review an audit, or look up a unit.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <div className="tablewrap">
        <table>
          <thead><tr><th>Property</th><th>ClassID</th><th>Installed by us</th><th className="n">Units</th><th>Last audit</th><th className="n">Documents</th></tr></thead>
          <tbody>
            {props.map((p) => (
              <tr key={p.id}>
                <td><a href={`/properties/${p.id}`}>{p.name}</a></td><td>{p.class_id}</td>
                <td>{p.installed_by_us ? <Badge tone="ok">Yes</Badge> : <Badge>No</Badge>}</td>
                <td className="n">{p.units}</td><td>{p.last_audit ?? '—'}</td><td className="n">{p.docs}</td>
              </tr>
            ))}
            {!props.length && <tr><td colSpan={6} className="small">No properties yet.</td></tr>}
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
