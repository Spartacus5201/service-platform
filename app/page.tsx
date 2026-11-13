import { getDb } from '@/src/server/db';
import { requireSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { listProperties } from '@/src/server/queries';
import { createProperty } from './actions';
import { todayQueues } from '@/src/queries/today';
import { Badge, Flash, one, type SP } from './ui';

export default async function Home({ searchParams }: { searchParams: SP }) {
  const s = await requireSession();
  const sp = await searchParams;
  const db = await getDb();
  const props = await listProperties(db);
  const showToday = can(s.role, 'edit_documents');
  const q = showToday ? await todayQueues(db, new Date().toISOString().slice(0, 10)) : null;
  const total = q ? q.units.length + q.draftNotes.length + q.idUpdates.length + q.uninvoiced.length + q.failed.length : 0;
  return (
    <>
      <h1>{q ? 'Home' : 'Properties'}</h1>
      <p className="sub">Pick a property to import reports, review an audit, or look up a unit.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      {q && (
        <section className="card" style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>Today</h2>
          {!total && <p className="small">Nothing is waiting on anyone.</p>}
          {!!q.units.length && <><h3>Units needing action</h3><ul>{q.units.map((x) => <li key={x.propertyId}><a href={`/properties/${x.propertyId}/audits/${x.batchId}`}>{x.property}</a>: {x.count} unit{x.count === 1 ? '' : 's'} (audit {x.auditedOn})</li>)}</ul></>}
          {!!q.draftNotes.length && <><h3>Service notes waiting for approval</h3><ul>{q.draftNotes.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}`}>{x.property}</a>: visit {x.visitedOn}, {x.units} unit{x.units === 1 ? '' : 's'}</li>)}</ul></>}
          {!!q.uninvoiced.length && <><h3>Approved visits not yet sent for invoicing</h3><ul>{q.uninvoiced.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}`}>{x.property}</a>: visit {x.visitedOn}, {x.units} unit{x.units === 1 ? '' : 's'}</li>)}</ul></>}
          {!!q.idUpdates.length && <><h3>ID updates not yet sent</h3><ul>{q.idUpdates.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}/ids`}>{x.property}</a>: visit {x.visitedOn}, {x.rows} change{x.rows === 1 ? '' : 's'}</li>)}</ul></>}
          {!!q.failed.length && <><h3>Follow-up: the fix did not hold</h3><ul>{q.failed.map((x, i) => <li key={i}><a href={`/visits/${x.visitId}`}>{x.property}</a>: {x.unit} {x.service}: {x.evidence}</li>)}</ul></>}
        </section>
      )}
      <h2>Properties</h2>
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
