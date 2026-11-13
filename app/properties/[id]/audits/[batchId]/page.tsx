import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireSession } from '@/src/server/session';
import { today } from '@/src/server/dates';
import { can } from '@/src/auth/auth';
import { auditLines } from '@/src/queries/audit';
import { ACTIONS } from '@/src/review/overrides';
import { stagedLines, countStages, STAGE_LABEL, type UnitStage } from '@/src/service/unitstatus';
import { createDocumentAction, overrideAction } from '../../../../actions';
import { openJobs } from '@/src/jobs/jobs';
import { Badge, Flash, actionTone, warrantyTone, one, us, type SP } from '../../../../ui';

export default async function AuditReview({ params, searchParams }: { params: Promise<{ id: string; batchId: string }>; searchParams: SP }) {
  const s = await requireSession();
  const { id, batchId } = await params; const sp = await searchParams;
  const db = await getDb();
  const b = (await db.query<{ kind: string; filename: string | null; imported_at: string; name: string }>(
    `SELECT i.kind, i.filename, i.imported_at::text, p.name FROM import_batch i JOIN property p ON p.id=i.property_id WHERE i.id=$1 AND i.property_id=$2`, [batchId, id])).rows[0];
  if (!b) notFound();
  const all = await auditLines(db, batchId, today());
  const showAll = one(sp.show) === 'all'; const showPm = one(sp.show) === 'pm';
  const actionable = all.filter((l) => l.recommendation.action !== 'No action');
  const lines = showAll ? all : showPm ? all.filter((l) => l.lowBattery) : actionable;
  const count = (a: string) => all.filter((l) => l.recommendation.action === a).length;
  const canDocs = can(s.role, 'edit_documents');
  const base = `/properties/${id}/audits/${batchId}`;
  const staged = await stagedLines(db, batchId, today());
  const stage = new Map(staged.map((l) => [l.readingId, l]));
  const sc = countStages(staged);
  const jobs = canDocs ? await openJobs(db, id) : [];
  const batchJob = (await db.query<{ job_id: string | null }>(`SELECT job_id FROM import_batch WHERE id=$1`, [batchId])).rows[0]?.job_id ?? '';
  const stageTone = (x: UnitStage) => (x === 'needs_document' || x === 'revisit' || x === 'not_fixed' ? 'warn' : x === 'visited' ? 'ok' : 'info');
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${id}`}>{b.name}</a> / Audit review</div>
      <h1>Audit review</h1>
      <p className="sub">{b.kind === 'manual_audit' ? 'Manual Audit' : 'Auto Audit'} · {b.filename ?? 'file'} · imported {b.imported_at.slice(0, 16).replace('T', ' ')}</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <div className="stats">
        <div className="stat"><b>{all.length}</b><span>readings</span></div>
        <div className="stat"><b>{count('Needs Service')}</b><span>Needs Service</span></div>
        <div className="stat"><b>{count('Verify ID')}</b><span>Verify ID</span></div>
        <div className="stat"><b>{count('Investigate')}</b><span>Investigate</span></div>
        <div className="stat"><b>{count('Requested by property')}</b><span>Requested</span></div>
        <div className="stat"><b>{count('Unrecognized')}</b><span>Unrecognized</span></div>
        <div className="stat"><b>{all.filter((l) => l.lowBattery).length}</b><span>Low battery (PM)</span></div>
      </div>
      {!!staged.length && <p className="small">Where the flagged units stand: {(Object.keys(sc) as UnitStage[]).filter((k) => sc[k]).map((k) => `${STAGE_LABEL[k]} ${sc[k]}`).join(' · ')}</p>}
      {all.some((l) => l.occupied === null) && <div className="flash">Occupancy is unknown for some units, so they are treated as occupied. Import an occupancy report to refine this.</div>}
      <div className="filters">
        <a className={showAll || showPm ? '' : 'on'} href={base}>Needs action ({actionable.length})</a>
        <a className={showAll ? 'on' : ''} href={`${base}?show=all`}>All ({all.length})</a>
        {all.some((l) => l.lowBattery) && <a className={showPm ? 'on' : ''} href={`${base}?show=pm`}>Low battery ({all.filter((l) => l.lowBattery).length})</a>}
        {canDocs && <span style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem' }}>
          <a href={`${base}/export?format=csv`} download>CSV</a><a href={`${base}/export?format=xlsx`} download>Excel</a><a href={`${base}/export?format=pdf`} download>PDF</a>
          <a href={`${base}/export?format=case`} download title="Raw files plus this audit as a test case for the evaluation harness">Save as test case</a>
        </span>}
      </div>
      {all.some((l) => l.override) && <p className="small">{all.filter((l) => l.override).length} row(s) changed by a reviewer, marked <Badge tone="info">edited</Badge>.</p>}
      <div className="tablewrap"><table>
        <thead><tr><th>Unit</th><th>Svc</th><th>Result</th><th>Recommendation</th><th>Why</th><th>Warranty</th><th>Status</th>{canDocs && <th></th>}</tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.readingId} className={l.recommendation.action === 'No action' ? 'muted' : ''}>
              <td className="nowrap"><a href={`/endpoints/${l.endpointId}`}>{l.building}-{l.unit}</a></td><td>{l.service}{l.isManual ? ' (manual)' : ''}</td><td>{l.code || '—'}{l.lowBattery && <> <Badge tone="warn">{l.recommendation.action === 'No action' ? 'PM · ' : ''}battery {l.lowBattery.level === null ? 'low' : `${l.lowBattery.level}%`} since {us(l.lowBattery.since)}</Badge></>}</td>
              <td><Badge tone={actionTone(l.recommendation.action)}>{l.recommendation.action}</Badge>{l.override && <> <Badge tone="info">edited</Badge></>}{l.recommendation.owner ? <span className="small"> · {l.recommendation.owner}</span> : null}{l.recommendation.component ? <span className="small"> · {l.recommendation.component}</span> : null}</td>
              <td className="small">{l.recommendation.reason}</td>
              <td className="small">{l.recommendation.action === 'No action' ? '' : (
                <>
                  <Badge tone={warrantyTone(l.coverage.install.status)}>install {l.coverage.install.status}</Badge>{' '}
                  <Badge tone={warrantyTone(l.coverage.labor.status)}>labor {l.coverage.labor.status}</Badge>{' '}
                  <Badge tone={warrantyTone(l.coverage.part.status)}>part {l.coverage.part.status}</Badge>
                </>)}</td>
              <td className="small">{(() => { const g = stage.get(l.readingId); if (!g) return null; return (<>
                <Badge tone={stageTone(g.stage)}>{STAGE_LABEL[g.stage]}</Badge>
                {g.doc && (g.stage === 'on_document') && <> <a href={`/documents/${g.doc.id}`}>{g.doc.number}</a>{g.doc.issued ? '' : ' (draft)'}</>}
                {g.lastVisit && g.stage !== 'on_document' && <> <a href={`/visits/${g.lastVisit.visitId}`}>visit {us(g.lastVisit.visitedOn)}</a></>}
              </>); })()}</td>
              {canDocs && (
                <td>
                  <details>
                    <summary className="small">Change</summary>
                    <form action={overrideAction} style={{ minWidth: 220 }}>
                      <input type="hidden" name="property_id" value={id} /><input type="hidden" name="batch_id" value={batchId} /><input type="hidden" name="reading_id" value={l.readingId} />{showAll && <input type="hidden" name="show" value="all" />}
                      <div className="field"><label>Final answer</label>
                        <select name="action" defaultValue={l.recommendation.action}>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select></div>
                      <div className="field"><label>If Investigate: who</label>
                        <select name="owner" defaultValue={l.recommendation.owner ?? 'property'}><option value="property">property</option><option value="service coordinator">service coordinator</option></select></div>
                      <div className="field"><label>If Needs Service or Verify ID: part</label>
                        <select name="component" defaultValue={l.recommendation.component ?? ''}><option value="">(rules default)</option><option>meter</option><option>transmitter</option><option>both</option><option>manual_pick</option></select></div>
                      <div className="field"><label>Why</label><input name="reason" defaultValue={l.override?.reason ?? ''} placeholder="e.g. tenant reported a leak" /></div>
                      <div className="actions"><button type="submit">Save</button>{l.override && <button className="secondary" type="submit" name="intent" value="clear" formNoValidate>Use rules&apos; answer</button>}</div>
                      {l.override && <p className="small">Rules said: {l.rules.action}. Changed by {l.override.by ?? 'someone'}.</p>}
                    </form>
                  </details>
                </td>)}
            </tr>
          ))}
          {!lines.length && <tr><td colSpan={8} className="small">Nothing needs action in this report.</td></tr>}
        </tbody>
      </table></div>

      {canDocs && (
        <form action={createDocumentAction} className="card" style={{ marginTop: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Draft a document from this audit</h2>
          <p className="small" style={{ marginTop: 0 }}>Starts with every line that needs service, plus Investigate and Verify ID lines (unpriced). Unrecognized codes are left off. You can edit before issuing.</p>
          <input type="hidden" name="property_id" value={id} /><input type="hidden" name="batch_id" value={batchId} />
          <div className="row">
            <div className="field"><label htmlFor="job_id">Job</label><select id="job_id" name="job_id" defaultValue={batchJob}><option value="">New job from this audit</option>{jobs.map((x) => <option key={x.id} value={x.id}>#{x.number} {x.title}</option>)}</select></div>
            <div className="field"><label htmlFor="type">Type</label><select id="type" name="type"><option value="WA">Work Authorization</option><option value="Proposal">Proposal</option><option value="RFM">RFM</option></select></div>
            <div className="field" style={{ flex: 2 }}><label htmlFor="title">Project name</label><input id="title" name="title" /></div>
            <div className="field"><label htmlFor="salesforce_case">Salesforce Case</label><input id="salesforce_case" name="salesforce_case" /></div>
            <div className="field"><label htmlFor="salesforce_work_order">Work Order</label><input id="salesforce_work_order" name="salesforce_work_order" /></div>
          </div>
          <label style={{ display: 'flex', gap: '1rem' }}>If Proposal, it also acts as: <span><input type="checkbox" name="acts_as" value="WA" /> WA</span><span><input type="checkbox" name="acts_as" value="RFM" /> RFM</span></label>
          <div className="actions"><button type="submit">Create draft</button></div>
        </form>
      )}
    </>
  );
}
