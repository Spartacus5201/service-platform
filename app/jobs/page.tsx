import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { today } from '@/src/server/dates';
import { listJobs, STAGES, STAGE } from '@/src/jobs/jobs';
import { Flash, one, us, daysSince, type SP } from '../ui';
import { StageBadge } from './stage';

export default async function Jobs({ searchParams }: { searchParams: SP }) {
  await requireCan('job.view');
  const sp = await searchParams;
  const db = await getDb();
  const property = one(sp.property);
  const closed = one(sp.closed) === '1';
  const jobs = await listJobs(db, { propertyId: property, includeClosed: closed });
  const props = (await db.query<{ id: string; name: string }>(`SELECT id, name FROM property ORDER BY name`)).rows;
  const t = today();
  const stages = STAGES.filter((x) => (closed ? true : x !== 'closed')).filter((x) => jobs.some((j) => j.stage === x));
  return (
    <>
      <h1>Jobs</h1>
      <p className="sub">Every piece of work from request to invoice, by where it stands. Authorization and scheduling are tracked on the Salesforce case.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <form className="row" method="get">
        <div className="field"><label htmlFor="property">Property</label>
          <select id="property" name="property" defaultValue={property ?? ''}><option value="">All properties</option>{props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="field"><label><input type="checkbox" name="closed" value="1" defaultChecked={closed} /> Include closed</label></div>
        <div className="field"><button type="submit" className="secondary">Show</button></div>
      </form>
      {!jobs.length && <p className="small">No jobs. Start one from a property page when a request comes in.</p>}
      {stages.map((st) => {
        const list = jobs.filter((j) => j.stage === st);
        return (
          <section key={st} style={{ marginTop: '1.25rem' }}>
            <h2 style={{ marginBottom: '.25rem' }}>{STAGE[st].label} <span className="small">({list.length})</span></h2>
            {STAGE[st].next && <p className="small" style={{ marginTop: 0 }}>Next: {STAGE[st].next}</p>}
            <div className="tablewrap"><table>
              <thead><tr><th>Job</th><th>Property</th><th>Requested</th><th>Case</th><th>Salesforce status</th><th>Units</th><th className="n">Days in stage</th></tr></thead>
              <tbody>{list.map((j) => (
                <tr key={j.id}>
                  <td><a href={`/jobs/${j.id}`}>#{j.number} {j.title}</a></td>
                  <td><a href={`/properties/${j.propertyId}`}>{j.property}</a></td>
                  <td className="nowrap">{us(j.requestedOn)}</td><td>{j.salesforceCase ?? ''}</td><td className="small">{j.salesforceStatus ?? ''}</td>
                  <td>{j.units.length || ''}</td><td className="n">{daysSince(j.since, t)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        );
      })}
      {!!jobs.length && <p className="small" style={{ marginTop: '1rem' }}>Stages: {STAGES.map((x) => <span key={x} style={{ marginRight: '.4rem' }}><StageBadge stage={x} /></span>)}</p>}
    </>
  );
}
