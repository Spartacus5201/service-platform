import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { closeoutData } from '@/src/service/closeout';
import { buildIdUpdate } from '@/src/service/idupdate';
import { markIdUpdateSentAction, saveIdUpdateAction } from '../../../actions';
import { Badge, Flash, one, type SP } from '../../../ui';

export default async function IdUpdate({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireCan('edit_documents');
  const { id } = await params; const sp = await searchParams;
  const db = await getDb();
  const c = await closeoutData(db, id).catch(() => null); if (!c) notFound();
  const rows = await buildIdUpdate(db, id);
  const pending = rows.filter((r) => r.status === 'pending').length;
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${c.property.id}`}>{c.property.name}</a> / <a href={`/visits/${id}`}>Service notes {c.visit.visitedOn}</a> / ID update</div>
      <h1>ID update record</h1>
      <p className="sub">Units whose equipment IDs changed on this visit, for the billing system. "Old" is what the billing system should hold now; "New" is what it needs. Port and Net are almost always 0; change them only where the billing system shows otherwise.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      {rows.length ? (
        <form action={saveIdUpdateAction}>
          <input type="hidden" name="visit_id" value={id} />
          <div className="tablewrap"><table>
            <thead><tr><th>Unit</th><th>Old MDID</th><th>New MDID</th><th>MIUID</th><th>Port</th><th>Net</th><th>System type</th><th>Meter type</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const lock = r.status !== 'pending';
                return (
                  <tr key={r.id}>
                    <td className="nowrap"><input type="hidden" name="row" value={r.id} />{r.building}-{r.unit} {r.service}</td>
                    <td>{r.oldMdid ?? '—'}</td>
                    <td><strong>{r.newMdid ?? '—'}</strong>{r.recoup && <div className="small">old one to recoup</div>}</td>
                    <td><input name={`miuid_${r.id}`} defaultValue={r.newMiuid ?? ''} disabled={lock} size={10} aria-label="MIUID" /></td>
                    <td><input className="num" name={`port_${r.id}`} defaultValue={r.newPort} disabled={lock} size={3} aria-label="Port" /></td>
                    <td><input className="num" name={`net_${r.id}`} defaultValue={r.newNet} disabled={lock} size={3} aria-label="Net" /></td>
                    <td><input name={`system_${r.id}`} defaultValue={r.systemType ?? ''} disabled={lock} size={10} aria-label="System type" /></td>
                    <td><input name={`meter_${r.id}`} defaultValue={r.meterType ?? ''} disabled={lock} size={12} aria-label="Meter type" /></td>
                    <td><Badge tone={r.status === 'confirmed' ? 'ok' : r.status === 'exported' ? 'info' : 'warn'}>{r.status}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <div className="actions" style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
            {pending > 0 && <button type="submit" className="secondary">Save changes</button>}
            <a className="btn secondary" href={`/visits/${id}/ids/export`}>Download workbook (.xlsx)</a>
          </div>
        </form>
      ) : <div className="card">No equipment was replaced on this visit, so nothing needs changing in the billing system.</div>}
      {pending > 0 && <form action={markIdUpdateSentAction} style={{ marginTop: '1rem' }}><input type="hidden" name="visit_id" value={id} /><button type="submit">Mark as sent to billing</button></form>}
    </>
  );
}
