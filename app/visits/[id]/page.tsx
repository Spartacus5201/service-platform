import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCanOwn } from '@/src/server/session';
import { isOwnVisit } from '@/src/jobs/own';
import { can, canOwn } from '@/src/auth/auth';
import { closeoutData, clientText } from '@/src/service/closeout';
import { corrections } from '@/src/service/correct';
import { aarForVisit, AAR_LABEL } from '@/src/service/aar';
import { addPhotoAction, approveCloseoutAction, recordInvoiceRefAction, saveCloseoutAction, sendInvoiceSheetAction } from '../../server-actions/field';
import type { ReactNode } from 'react';
import { Badge, Flash, one, us, type SP, type Tone } from '../../ui';

export default async function VisitCloseout({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const s = await requireCanOwn('job.view');
  const { id } = await params; const sp = await searchParams;
  const db = await getDb();
  // Own-records holders (technicians) see their own visits: what was done and whether it held, and add photos.
  const full = can(s, 'job.view');
  if (!full && !(await isOwnVisit(db, id, s.userId))) notFound();
  const canWording = can(s, 'visit.record'); const canApprove = can(s, 'notes.approve'); const canPhoto = canOwn(s, 'visit.record');
  const c = await closeoutData(db, id).catch(() => null); if (!c) notFound();
  const approved = c.visit.status === 'approved';
  const subs = (await db.query<{ ref: string | null }>(`SELECT DISTINCT s.id, s.external_ref ref FROM invoice_submission s JOIN invoice_line il ON il.submission_id=s.id JOIN service_event se ON se.id=il.service_event_id WHERE se.visit_id=$1`, [id])).rows;
  const invoiced = subs.length > 0;
  const invoiceRef = subs.map((x) => x.ref).filter(Boolean).join(', ');
  const canInvoice = can(s, 'invoice.manage');
  const log = await corrections(db, id);
  const aar = await aarForVisit(db, id);
  const job = (await db.query<{ id: string; number: number }>(`SELECT j.id, j.number FROM job j JOIN visit v ON v.job_id=j.id WHERE v.id=$1`, [id])).rows[0];
  const ids = (await db.query<{ status: string; n: string }>(`SELECT status, count(*) n FROM id_update WHERE visit_id=$1 GROUP BY status`, [id])).rows;
  const idn = (st: string) => Number(ids.find((x) => x.status === st)?.n ?? 0);
  const replaced = c.units.filter((u) => u.newTxId).length;
  const failing = aar.rows.filter((r) => ['still_failing', 'new_problem', 'revisit'].includes(r.outcome)).length;
  const waitingAudit = aar.rows.filter((r) => r.outcome === 'awaiting_audit').length;

  type St = { tone: Tone; label: string };
  const st: St[] = [
    approved ? { tone: 'ok', label: 'Approved' } : { tone: 'warn', label: 'To do' },
    failing ? { tone: 'bad', label: `${failing} not fixed` } : waitingAudit ? { tone: 'gray', label: `Waiting for audit (due ${us(aar.postAuditDue)})` } : { tone: 'ok', label: 'All working' },
    !replaced ? { tone: 'ok', label: 'No ID changes' } : idn('pending') ? { tone: 'warn', label: `${idn('pending')} to send` } : idn('exported') ? { tone: 'gray', label: 'Sent, awaiting confirmation' } : idn('confirmed') ? { tone: 'ok', label: 'Confirmed' } : { tone: 'gray', label: 'Built when notes are approved' },
    !approved ? { tone: 'gray', label: 'Blocked: approve step 1' } : !invoiced ? { tone: 'warn', label: 'To send' } : !invoiceRef ? { tone: 'gray', label: 'Sent, no invoice # yet' } : { tone: 'ok', label: `Invoice ${invoiceRef}` },
    !approved ? { tone: 'gray', label: 'Blocked: approve step 1' } : { tone: 'ok', label: 'Ready to share' },
  ];
  const TITLES = ['Process the notes', 'Check it works', 'ID update', 'Invoicing sheet', 'Client service notes'];
  const Step = ({ n, children, hint }: { n: number; hint: string; children: ReactNode }) => (
    <section id={`step${n}`} className="card step">
      <h2 style={{ marginTop: 0 }}><span className="stepno">{n}</span> {TITLES[n - 1]} <Badge tone={st[n - 1].tone}>{st[n - 1].label}</Badge></h2>
      <p className="small" style={{ marginTop: 0 }}>{hint}</p>
      {children}
    </section>
  );
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${c.property.id}`}>{c.property.name}</a>{job && <> / <a href={`/jobs/${job.id}`}>Job #{job.number}</a></>} / Service notes {us(c.visit.visitedOn)}</div>
      <h1>Service visit {us(c.visit.visitedOn)}</h1>
      <p className="sub">{c.visit.technician ?? 'no technician'} · {c.property.name} · code {c.code}, charge {c.chargeCode}{c.visit.documentNumber ? ` · WA ${c.visit.documentNumber}` : ''}
        {' '}· NI {c.counts.NI} · NT {c.counts.NT} · INT {c.counts.INT} · High/Low {c.counts.HIGHLOW} · Other {c.counts.other} · Total {c.counts.total}</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <ol className="steps">{TITLES.slice(0, full ? TITLES.length : 2).map((t, i) => <li key={t}><a href={`#step${i + 1}`}><span className="stepno">{i + 1}</span> {t}</a> <Badge tone={st[i].tone}>{st[i].label}</Badge></li>)}</ol>

      <Step n={1} hint="Read what the technician reported and turn it into client wording. Wording is drafted from fixed phrases for the issue and result; edit anything. Saving after approval sends the notes back to draft.">
{canWording && (        <form action={saveCloseoutAction}>
          <input type="hidden" name="visit_id" value={id} />
          <div className="field"><label htmlFor="summary">Opening paragraph for the client (optional)</label><textarea id="summary" name="summary" rows={2} defaultValue={c.visit.summary ?? ''} /></div>
          <div className="tablewrap"><table>
            <thead><tr><th>Unit</th><th>Issue</th><th>Result</th><th>Technician said (internal)</th><th>Wording for the client</th><th>Additional comment</th></tr></thead>
            <tbody>
              {c.units.map((u) => (
                <tr key={u.eventId}>
                  <td className="nowrap"><input type="hidden" name="event" value={u.eventId} /><a href={`/endpoints/${u.endpointId}`}>{u.building}-{u.unit}</a><div className="small">{u.startRead ?? '—'} → {u.endRead ?? '—'}{u.newTxId ? ` · new TX ${u.newTxId}` : ''}</div></td>
                  <td>{u.issue}</td><td>{u.resultLabel}</td>
                  <td className="small">{u.techNotes ?? '—'}</td>
                  <td style={{ minWidth: "24rem" }}><textarea name={`comment_${u.eventId}`} rows={4} defaultValue={clientText(u)} aria-label={`Client wording for ${u.building}-${u.unit}`} /></td>
                  <td style={{ minWidth: "14rem" }}><textarea name={`extra_${u.eventId}`} rows={3} defaultValue={u.extraComment ?? ''} aria-label="Additional comment" /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="actions"><button type="submit" className="secondary">Save wording</button></div>
        </form>)}
        {!canWording && <div className="tablewrap"><table>
          <thead><tr><th>Unit</th><th>Issue</th><th>Result</th><th>Notes</th></tr></thead>
          <tbody>{c.units.map((u) => <tr key={u.eventId}><td className="nowrap">{u.building}-{u.unit}<div className="small">{u.startRead ?? '—'} → {u.endRead ?? '—'}{u.newTxId ? ` · new TX ${u.newTxId}` : ''}</div></td><td>{u.issue}</td><td>{u.resultLabel}</td><td className="small">{u.techNotes ?? '—'}</td></tr>)}</tbody>
        </table></div>}
        <h3>Photos</h3>
        <div className="tablewrap"><table><tbody>
          {c.photos.map((p) => (
            <tr key={p.id}><td><a href={`/visits/${id}/photo/${p.id}`} target="_blank">{p.filename}</a></td><td>{p.caption ?? ''}</td><td>{p.includeInClient ? <Badge tone="ok">in client notes</Badge> : <Badge>internal</Badge>}</td></tr>
          ))}
          {!c.photos.length && <tr><td className="small">No photos.</td></tr>}
        </tbody></table></div>
{canPhoto && (        <form action={addPhotoAction} encType="multipart/form-data" className="row">
          <input type="hidden" name="visit_id" value={id} />
          <div className="field"><label htmlFor="photo">Photo (JPEG or PNG, up to 8 MB)</label><input id="photo" name="photo" type="file" accept="image/jpeg,image/png" /></div>
          <div className="field"><label htmlFor="endpoint_id">Unit</label>
            <select id="endpoint_id" name="endpoint_id"><option value="">General</option>{c.units.map((u) => <option key={u.endpointId} value={u.endpointId}>{u.building}-{u.unit}</option>)}</select></div>
          <div className="field"><label htmlFor="caption">Caption</label><input id="caption" name="caption" /></div>
          <div className="field"><label><input type="checkbox" name="include" /> Show to client</label></div>
          <div className="actions"><button type="submit" className="secondary">Add photo</button></div>
        </form>)}
        {!approved && canApprove && <form action={approveCloseoutAction} style={{ marginTop: '1rem' }}><input type="hidden" name="visit_id" value={id} /><button type="submit">Approve client wording</button> <span className="small">Unlocks invoicing and the final client notes, and builds the ID update.</span></form>}
      </Step>

      <Step n={2} hint="Each serviced unit before the visit, what was done, and the first audit or check-in after it. Re-checked automatically with every import.">
        <div className="tablewrap"><table>
          <thead><tr><th>Unit</th><th>Before</th><th>Work done</th><th>After</th><th>Outcome</th></tr></thead>
          <tbody>{aar.rows.map((r) => (
            <tr key={r.eventId}><td className="nowrap">{r.building}-{r.unit} {r.service}</td><td>{r.before.code ?? '—'}{r.before.auditEnded ? <span className="small"> to {us(r.before.auditEnded)}</span> : null}</td>
              <td className="small">{r.work}{r.newTxId ? ` · new ID ${r.newTxId}` : ''}</td><td className="small">{r.after.evidence}</td>
              <td><Badge tone={r.outcome === 'fixed' ? 'ok' : r.outcome === 'awaiting_audit' ? 'gray' : r.outcome === 'revisit' ? 'warn' : 'bad'}>{AAR_LABEL[r.outcome]}</Badge></td></tr>
          ))}{!aar.rows.length && <tr><td colSpan={5} className="small">No units.</td></tr>}</tbody>
        </table></div>
        <p><a className="btn secondary" href={`/aar?visit=${id}`} target="_blank">After Action Report PDF</a>{c.visit.documentId && <> <a className="btn secondary" href={`/aar?document=${c.visit.documentId}`} target="_blank">For the whole WA</a></>}</p>
      </Step>

      {full && (<>
      <Step n={3} hint="New transmitter or meter IDs that need updating in the billing system. Confirmed automatically when an import shows the new ID.">
        {replaced ? <p>{can(s, 'idupdate.manage') && <a className="btn secondary" href={`/visits/${id}/ids`}>Open the ID update record</a>} <span className="small">{replaced} unit(s) with a new ID.</span></p> : <p className="small">No equipment was replaced on this visit.</p>}
      </Step>

      <Step n={4} hint="The internal sheet admin uses to raise the invoice in the company layout.">
        {canInvoice ? (<>
          <p><a className="btn secondary" href={`/visits/${id}/export?kind=invoice`} target="_blank">Invoicing sheet PDF (internal)</a></p>
          {approved && !invoiced && (
            <form action={sendInvoiceSheetAction} className="row">
              <input type="hidden" name="visit_id" value={id} />
              <div className="field"><label htmlFor="external_ref">Admin reference (ticket or invoice no.)</label><input id="external_ref" name="external_ref" /></div>
              <div className="actions"><button type="submit">Record as sent to admin</button></div>
            </form>
          )}
          {invoiced && !invoiceRef && (
            <form action={recordInvoiceRefAction} className="row">
              <input type="hidden" name="visit_id" value={id} />
              <div className="field"><label htmlFor="inv_ref">Invoice number from admin</label><input id="inv_ref" name="external_ref" required /></div>
              <div className="actions"><button type="submit">Record invoice number</button></div>
            </form>
          )}
        </>) : <p className="small">Invoicing is handled by a user with pricing access.</p>}
      </Step>

      <Step n={5} hint="The customer-friendly service notes to share with the client.">
        <p><a className="btn secondary" href={`/visits/${id}/export?kind=notes`} target="_blank">Client notes PDF{approved ? '' : ' (draft)'}</a></p>
      </Step>

      <h2>Corrections</h2>
      {can(s, 'service.correct') && <p><a className="btn secondary" href={`/visits/${id}/correct`}>Correct this record</a></p>}
      {log.length > 0 && <div className="tablewrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>Change</th><th>Reason</th></tr></thead>
        <tbody>{log.map((l, i) => <tr key={i}><td className="nowrap">{l.at}</td><td>{l.by ?? '—'}</td><td>{l.summary}</td><td>{l.reason ?? '—'}</td></tr>)}</tbody>
      </table></div>}
      </>)}
    </>
  );
}
