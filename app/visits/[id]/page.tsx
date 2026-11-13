import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { closeoutData, clientText } from '@/src/service/closeout';
import { RESULT_LABEL } from '@/src/service/phrases';
import { addPhotoAction, approveCloseoutAction, saveCloseoutAction, sendInvoiceSheetAction } from '../../actions';
import { Badge, Flash, one, type SP } from '../../ui';

export default async function VisitCloseout({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const s = await requireCan('edit_documents');
  const { id } = await params; const sp = await searchParams;
  const db = await getDb();
  const c = await closeoutData(db, id).catch(() => null); if (!c) notFound();
  const approved = c.visit.status === 'approved';
  const invoiced = !!(await db.query(`SELECT 1 FROM invoice_line il JOIN service_event se ON se.id=il.service_event_id WHERE se.visit_id=$1 LIMIT 1`, [id])).rows.length;
  const canInvoice = can(s.role, 'edit_prices');
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${c.property.id}`}>{c.property.name}</a> / Service notes {c.visit.visitedOn}</div>
      <h1>Service notes</h1>
      <p className="sub">{c.visit.visitedOn} · {c.visit.technician ?? 'no technician'} · {c.property.name} · code {c.code}, charge {c.chargeCode}{c.visit.documentNumber ? ` · WA ${c.visit.documentNumber}` : ''}</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <p>{approved ? <Badge tone="ok">approved</Badge> : <Badge tone="warn">draft</Badge>} {invoiced && <Badge tone="info">sent to admin</Badge>}
        {' '}NI {c.counts.NI} · NT {c.counts.NT} · INT {c.counts.INT} · High/Low {c.counts.HIGHLOW} · Other {c.counts.other} · Total {c.counts.total}</p>

      <form action={saveCloseoutAction}>
        <input type="hidden" name="visit_id" value={id} />
        <div className="field"><label htmlFor="summary">Opening paragraph for the client (optional)</label><textarea id="summary" name="summary" rows={2} defaultValue={c.visit.summary ?? ''} /></div>
        <div className="tablewrap"><table>
          <thead><tr><th>Unit</th><th>Issue</th><th>Result</th><th>Technician said (internal)</th><th>Wording for the client</th><th>Additional comment</th></tr></thead>
          <tbody>
            {c.units.map((u) => (
              <tr key={u.eventId}>
                <td className="nowrap"><input type="hidden" name="event" value={u.eventId} />{u.building}-{u.unit}<div className="small">{u.startRead ?? '—'} → {u.endRead ?? '—'}{u.newTxId ? ` · new TX ${u.newTxId}` : ''}</div></td>
                <td>{u.issue}</td><td>{RESULT_LABEL[u.result]}</td>
                <td className="small">{u.techNotes ?? '—'}</td>
                <td style={{ minWidth: "24rem" }}><textarea name={`comment_${u.eventId}`} rows={4} defaultValue={clientText(u)} aria-label={`Client wording for ${u.building}-${u.unit}`} /></td>
                <td style={{ minWidth: "14rem" }}><textarea name={`extra_${u.eventId}`} rows={3} defaultValue={u.extraComment ?? ''} aria-label="Additional comment" /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="small">The wording is drafted from fixed phrases for the issue and result. Edit anything; saving sends approved notes back to draft.</p>
        <div className="actions"><button type="submit" className="secondary">Save wording</button></div>
      </form>

      <h2>Photos</h2>
      <div className="tablewrap"><table><tbody>
        {c.photos.map((p) => (
          <tr key={p.id}><td><a href={`/visits/${id}/photo/${p.id}`} target="_blank">{p.filename}</a></td><td>{p.caption ?? ''}</td><td>{p.includeInClient ? <Badge tone="ok">in client notes</Badge> : <Badge>internal</Badge>}</td></tr>
        ))}
        {!c.photos.length && <tr><td className="small">No photos.</td></tr>}
      </tbody></table></div>
      <form action={addPhotoAction} encType="multipart/form-data" className="row">
        <input type="hidden" name="visit_id" value={id} />
        <div className="field"><label htmlFor="photo">Photo (JPEG or PNG, up to 8 MB)</label><input id="photo" name="photo" type="file" accept="image/jpeg,image/png" /></div>
        <div className="field"><label htmlFor="endpoint_id">Unit</label>
          <select id="endpoint_id" name="endpoint_id"><option value="">General</option>{c.units.map((u) => <option key={u.endpointId} value={u.endpointId}>{u.building}-{u.unit}</option>)}</select></div>
        <div className="field"><label htmlFor="caption">Caption</label><input id="caption" name="caption" /></div>
        <div className="field"><label><input type="checkbox" name="include" /> Show to client</label></div>
        <div className="actions"><button type="submit" className="secondary">Add photo</button></div>
      </form>

      <h2>Finish</h2>
      <div className="actions" style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
        <a className="btn secondary" href={`/visits/${id}/export?kind=notes`} target="_blank">Client notes PDF{approved ? '' : ' (draft)'}</a>
        {canInvoice && <a className="btn secondary" href={`/visits/${id}/export?kind=invoice`} target="_blank">Invoicing sheet PDF (internal)</a>}
        {!approved && <form action={approveCloseoutAction}><input type="hidden" name="visit_id" value={id} /><button type="submit">Approve client notes</button></form>}
      </div>
      {canInvoice && approved && !invoiced && (
        <form action={sendInvoiceSheetAction} className="row" style={{ marginTop: '1rem' }}>
          <input type="hidden" name="visit_id" value={id} />
          <div className="field"><label htmlFor="external_ref">Admin reference (ticket or invoice no.)</label><input id="external_ref" name="external_ref" /></div>
          <div className="actions"><button type="submit">Record as sent to admin</button></div>
        </form>
      )}
    </>
  );
}
