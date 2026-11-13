import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { today } from '@/src/server/dates';
import { jobDetail, STAGE, SOURCE_LABEL, type JobSource } from '@/src/jobs/jobs';
import { AAR_LABEL } from '@/src/service/aar';
import { attachAuditAction, closeJobAction, createDocumentAction, refreshSalesforceAction, updateJobAction } from '../../actions';
import { salesforceMode } from '@/src/salesforce/client';
import { Badge, Flash, money, one, us, daysSince, type SP } from '../../ui';
import { StageBadge } from '../stage';

export default async function Job({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const s = await requireCan('edit_documents');
  const { id } = await params; const sp = await searchParams;
  const db = await getDb();
  const j = await jobDetail(db, id); if (!j) notFound();
  const canPrice = can(s.role, 'edit_prices');
  const freeAudits = (await db.query<{ id: string; on: string; filename: string | null }>(
    `SELECT id, imported_at::date::text "on", filename FROM import_batch WHERE property_id=$1 AND job_id IS NULL AND kind IN ('auto_audit','manual_audit') ORDER BY imported_at DESC LIMIT 20`, [j.propertyId])).rows;
  const latestAudit = j.audits[j.audits.length - 1];
  const open = j.stage !== 'closed';
  const firstWa = j.documents.find((d) => d.type !== 'RFM');
  const sf = salesforceMode();
  return (
    <>
      <div className="crumbs"><a href="/jobs">Jobs</a> / <a href={`/properties/${j.propertyId}`}>{j.property}</a> / #{j.number}</div>
      <h1>#{j.number} {j.title}</h1>
      <p className="sub"><StageBadge stage={j.stage} /> {daysSince(j.since, today())} days · {j.property} ({j.classId})
        {j.salesforceCase && <> · Case {j.salesforceCase}</>}{j.salesforceStatus && <> · <Badge tone="info">Salesforce: {j.salesforceStatus}</Badge></>}</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      {open && STAGE[j.stage].next && <div className="flash"><b>Next:</b> {STAGE[j.stage].next}</div>}

      <div className="stats">
        <div className="stat"><b>{j.units.length}</b><span>Units serviced</span></div>
        <div className="stat"><b>{j.outcomes.fixed}</b><span>Fixed</span></div>
        <div className="stat"><b>{j.outcomes.still_failing + j.outcomes.new_problem + j.outcomes.revisit}</b><span>Still open</span></div>
        <div className="stat"><b>{j.outcomes.awaiting_audit}</b><span>Awaiting audit</span></div>
        {canPrice && <div className="stat"><b>{money(j.money.quoted)}</b><span>Quoted</span></div>}
        {canPrice && <div className="stat"><b>{money(j.money.invoiced)}</b><span>Invoiced</span></div>}
      </div>

      <h2>Request</h2>
      <form action={updateJobAction} className="card">
        <input type="hidden" name="job_id" value={j.id} />
        <div className="row">
          <div className="field" style={{ flex: 2 }}><label htmlFor="title">Title</label><input id="title" name="title" defaultValue={j.title} required /></div>
          <div className="field"><label htmlFor="source">Came in by</label><select id="source" name="source" defaultValue={j.source}>{(Object.keys(SOURCE_LABEL) as JobSource[]).map((k) => <option key={k} value={k}>{SOURCE_LABEL[k]}</option>)}</select></div>
          <div className="field"><label htmlFor="requested_on">Requested on</label><input id="requested_on" name="requested_on" type="date" defaultValue={j.requestedOn} /></div>
          <div className="field"><label htmlFor="requested_by">Requested by</label><input id="requested_by" name="requested_by" defaultValue={j.requestedBy ?? ''} /></div>
        </div>
        <div className="row">
          <div className="field"><label htmlFor="salesforce_case">Salesforce case</label><input id="salesforce_case" name="salesforce_case" defaultValue={j.salesforceCase ?? ''} /></div>
          <div className="field" style={{ flex: 2 }}><label htmlFor="salesforce_status">Salesforce status (authorization, scheduling)</label><input id="salesforce_status" name="salesforce_status" defaultValue={j.salesforceStatus ?? ''} placeholder="Copied from the case until Salesforce is connected" /></div>
        </div>
        <div className="field"><label htmlFor="request_notes">What was asked</label><textarea id="request_notes" name="request_notes" rows={2} defaultValue={j.requestNotes ?? ''} /></div>
        <div className="actions"><button type="submit" className="secondary">Save request</button></div>
      </form>
      <form action={refreshSalesforceAction} className="row" style={{ marginTop: '.5rem', alignItems: 'center' }}>
        <input type="hidden" name="job_id" value={j.id} />
        {sf === 'off'
          ? <p className="small">Salesforce lookups are off on this server: type the case status by hand. They switch on when API access is granted (SALESFORCE-SETUP.md).</p>
          : <><button type="submit" className="secondary" disabled={!j.salesforceCase}>Refresh status from Salesforce</button>
              <span className="small">{sf === 'mock' ? 'Sample data (demo mode). ' : ''}{j.salesforceSyncedAt ? `Last read ${us(j.salesforceSyncedAt)} ${j.salesforceSyncedAt.slice(11, 16)}.` : 'Status typed by hand.'}</span></>}
      </form>

      <h2>Audit</h2>
      {j.audits.length ? <ul>{j.audits.map((a) => <li key={a.id}><a href={`/properties/${j.propertyId}/audits/${a.id}`}>{a.filename ?? `Audit${a.ended ? ` ending ${us(a.ended)}` : ''}`}</a> imported {us(a.on)}</li>)}</ul> : <p className="small">No audit attached.</p>}
      {open && !!freeAudits.length && (
        <form action={attachAuditAction} className="row">
          <input type="hidden" name="job_id" value={j.id} />
          <div className="field"><label htmlFor="batch_id">Attach an audit</label><select id="batch_id" name="batch_id">{freeAudits.map((a) => <option key={a.id} value={a.id}>{us(a.on)} {a.filename ?? ''}</option>)}</select></div>
          <div className="field"><button type="submit" className="secondary">Attach</button></div>
        </form>
      )}
      {open && !freeAudits.length && !j.audits.length && <p className="small">Import the audit on the <a href={`/properties/${j.propertyId}?tab=audits`}>property page</a>, then attach it here.</p>}

      <h2>Documents</h2>
      {j.documents.length ? (
        <div className="tablewrap"><table>
          <thead><tr><th>Document</th><th>Status</th><th>Drafted</th>{canPrice && <th className="n">Quoted</th>}</tr></thead>
          <tbody>{j.documents.map((d) => <tr key={d.id}><td><a href={`/documents/${d.id}`}>{d.type} {d.number}</a> {d.title ?? ''}</td><td>{d.issued ? <Badge tone="ok">issued</Badge> : <Badge>draft</Badge>}</td><td>{us(d.createdOn)}</td>{canPrice && <td className="n">{d.type === 'RFM' ? '—' : money(d.quoted)}</td>}</tr>)}</tbody>
        </table></div>
      ) : <p className="small">No documents yet.</p>}
      {open && (
        <form action={createDocumentAction} className="row">
          <input type="hidden" name="property_id" value={j.propertyId} /><input type="hidden" name="job_id" value={j.id} />
          {latestAudit && <input type="hidden" name="batch_id" value={latestAudit.id} />}
          <div className="field"><label htmlFor="type">New document</label><select id="type" name="type"><option value="WA">Work Authorization</option><option value="Proposal">Proposal</option><option value="RFM">RFM</option></select></div>
          <div className="field" style={{ flex: 2 }}><label htmlFor="dtitle">Project name</label><input id="dtitle" name="title" defaultValue={j.title} /></div>
          <input type="hidden" name="salesforce_case" value={j.salesforceCase ?? ''} />
          <div className="field"><button type="submit">{latestAudit ? 'Draft from the audit' : 'Start blank'}</button></div>
        </form>
      )}

      <h2>Service</h2>
      {j.visits.length ? (
        <div className="tablewrap"><table>
          <thead><tr><th>Visit</th><th>Units</th><th>Client notes</th><th>Invoicing</th></tr></thead>
          <tbody>{j.visits.map((v) => (
            <tr key={v.id}><td><a href={`/visits/${v.id}`}>{us(v.visitedOn)}</a> <span className="small">{v.outcome.replaceAll('_', ' ')}</span></td><td>{v.units}</td>
              <td>{v.notesStatus === 'approved' ? <Badge tone="ok">approved</Badge> : <Badge tone="warn">draft</Badge>}</td>
              <td>{v.invoiced ? <Badge tone={v.invoiceRef ? 'ok' : 'info'}>{v.invoiceRef ? `invoice ${v.invoiceRef}` : 'sent, no invoice # yet'}</Badge> : <Badge>not sent</Badge>}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="small">No service recorded yet.</p>}
      {open && <p><a className="btn secondary" href={`/properties/${j.propertyId}/closeout/new?job=${j.id}${firstWa ? `&document=${firstWa.id}` : ''}`}>Record service report →</a>
        {j.visits.length > 0 && firstWa && <> <a className="btn secondary" href={`/aar?document=${firstWa.id}`} target="_blank">After Action Report</a></>}</p>}
      {(j.idUpdates.pending + j.idUpdates.exported + j.idUpdates.confirmed > 0) && <p className="small">ID updates: {j.idUpdates.pending} not sent · {j.idUpdates.exported} sent, awaiting confirmation · {j.idUpdates.confirmed} confirmed.</p>}

      {!!j.units.length && (<>
        <h2>Units on this job</h2>
        <p className="small">Each unit's full service history is one click away.</p>
        <ul className="cols">{j.units.map((u) => <li key={u.endpointId}><a href={`/endpoints/${u.endpointId}`}>{u.label}</a> <Badge tone={u.outcome === 'fixed' ? 'ok' : u.outcome === 'awaiting_audit' ? 'gray' : 'bad'}>{AAR_LABEL[u.outcome]}</Badge></li>)}</ul>
      </>)}

      {canPrice && (j.money.quoted > 0 || j.money.invoiced > 0) && (<>
        <h2>Quoted vs invoiced</h2>
        <p>Quoted {money(j.money.quoted)} · Invoiced {money(j.money.invoiced)} · Difference <b style={{ color: j.money.difference ? 'var(--warn)' : undefined }}>{money(j.money.difference)}</b></p>
        <p className="small">Quoted is the latest issued version of each WA and Proposal (RFMs are the property's cost). Invoiced is what was sent to admin for this job's visits.</p>
      </>)}

      <h2>Timeline</h2>
      <ol className="jobline">{j.timeline.map((t, i) => <li key={i}><span className="nowrap small">{us(t.on)}</span> <b>{t.href ? <a href={t.href}>{t.what}</a> : t.what}</b>{t.detail ? <span className="small"> · {t.detail}</span> : null}</li>)}</ol>

      <h2>{open ? 'Close the job' : 'Closed'}</h2>
      <form action={closeJobAction} className="row">
        <input type="hidden" name="job_id" value={j.id} />
        {open ? (<>
          <input type="hidden" name="early" value={j.stage === 'ready' ? '0' : '1'} />
          <div className="field" style={{ flex: 2 }}><label htmlFor="close_reason">{j.stage === 'ready' ? 'Note (optional)' : 'Reason for closing before the work is finished'}</label><input id="close_reason" name="close_reason" required={j.stage !== 'ready'} /></div>
          <div className="field"><button type="submit" className={j.stage === 'ready' ? '' : 'secondary'}>Close job</button></div>
        </>) : (<>
          <p className="small">Closed {us(j.closedOn)}{j.closeReason ? `: ${j.closeReason}` : ''}.</p>
          <input type="hidden" name="reopen" value="1" /><div className="field"><button type="submit" className="secondary">Reopen</button></div>
        </>)}
      </form>
    </>
  );
}
