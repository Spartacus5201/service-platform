import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { closeoutData } from '@/src/service/closeout';
import { correctVisitAction } from '../../../server-actions/field';
import { Flash, one, type SP } from '../../../ui';

const ACTIONS = [['inspect_test', 'Inspect / test'], ['repair', 'Repair'], ['reprogram', 'Reprogram'], ['other', 'Other']];
const RESULTS = [['repaired', 'Repaired'], ['replaced', 'Replaced'], ['reprogrammed', 'Reprogrammed'], ['no_fault_found', 'No fault found'], ['unable_to_access', 'Unable to access'], ['unable_to_complete', 'Unable to complete'], ['other', 'Other']];

export default async function CorrectVisit({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireCan('service.correct');
  const { id } = await params; const sp = await searchParams;
  const db = await getDb();
  const c = await closeoutData(db, id).catch(() => null); if (!c) notFound();
  const invoiced = new Set((await db.query<{ service_event_id: string }>(`SELECT il.service_event_id FROM invoice_line il JOIN service_event se ON se.id=il.service_event_id WHERE se.visit_id=$1`, [id])).rows.map((r) => r.service_event_id));
  const v = c.visit;
  const docs = (await db.query<{ id: string; number: string; type: string }>(`SELECT id, number, type FROM document WHERE property_id=$1 AND type IN ('WA','Proposal') ORDER BY created_on DESC`, [c.property.id])).rows;
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${c.property.id}`}>{c.property.name}</a> / <a href={`/visits/${id}`}>Service notes {v.visitedOn}</a> / Correct</div>
      <h1>Correct service record</h1>
      <p className="sub">Nothing is deleted: changes are logged with your reason and shown on the visit. Invoiced units cannot be edited or voided, and a changed date or outcome recalculates warranty coverage. Client notes go back to draft.</p>
      <Flash error={one(sp.error)} />
      <form action={correctVisitAction}>
        <input type="hidden" name="visit_id" value={id} />
        <h2>Visit</h2>
        <div className="row">
          <div className="field"><label htmlFor="visited_on">Service date</label><input id="visited_on" name="visited_on" type="date" defaultValue={v.visitedOn} required /></div>
          <div className="field"><label htmlFor="technician">Technician</label><input id="technician" name="technician" defaultValue={v.technician ?? ''} /></div>
          <div className="field"><label htmlFor="outcome">Outcome</label>
            <select id="outcome" name="outcome" defaultValue={v.outcome}><option value="completed">Completed</option><option value="unable_to_access">Unable to access</option><option value="unable_to_complete">Unable to complete</option></select></div>
          <div className="field"><label htmlFor="salesforce_case">Salesforce case</label><input id="salesforce_case" name="salesforce_case" defaultValue={v.salesforceCase ?? ''} /></div>
          <div className="field"><label htmlFor="salesforce_work_order">Work order</label><input id="salesforce_work_order" name="salesforce_work_order" defaultValue={v.salesforceWorkOrder ?? ''} /></div>
          <div className="field"><label htmlFor="document_id">Work authorization</label><select id="document_id" name="document_id" defaultValue={v.documentId ?? ''}><option value="">None</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.type} {d.number}</option>)}</select></div>
        </div>
        <div className="field"><label htmlFor="visit_notes">Overall notes (internal)</label><textarea id="visit_notes" name="visit_notes" rows={2} defaultValue={v.notes ?? ''} /></div>

        <h2>Units</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Unit</th><th>Action</th><th>Issue</th><th>Result</th><th>Start read</th><th>End read</th><th>New transmitter ID</th><th>Technician comment</th><th>Void</th></tr></thead>
          <tbody>
            {c.units.map((u) => {
              const locked = invoiced.has(u.eventId); const isReplace = u.action === 'replace';
              return (
                <tr key={u.eventId} className={locked ? 'muted' : ''}>
                  <td className="nowrap">{u.building}-{u.unit}{locked && <div className="small">invoiced</div>}</td>
                  <td>{isReplace ? 'Replace' : <select name={`action_${u.eventId}`} defaultValue={u.action} disabled={locked} aria-label="Action">{ACTIONS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>}</td>
                  <td>{isReplace ? u.issueCode ?? '' : <input name={`issue_${u.eventId}`} defaultValue={u.issueCode ?? ''} disabled={locked} size={6} aria-label="Issue code" />}</td>
                  <td>{isReplace ? u.result : <select name={`result_${u.eventId}`} defaultValue={u.result} disabled={locked} aria-label="Result">{RESULTS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>}</td>
                  <td>{isReplace ? u.startRead ?? '' : <input className="num" name={`start_${u.eventId}`} defaultValue={u.startRead ?? ''} disabled={locked} aria-label="Start read" />}</td>
                  <td>{isReplace ? u.endRead ?? '' : <input className="num" name={`end_${u.eventId}`} defaultValue={u.endRead ?? ''} disabled={locked} aria-label="End read" />}</td>
                  <td>{isReplace ? <input name={`newtx_${u.eventId}`} defaultValue={u.newTxId ?? ''} aria-label="New transmitter ID" /> : '—'}</td>
                  <td>{isReplace ? u.techNotes ?? '' : <input name={`notes_${u.eventId}`} defaultValue={u.techNotes ?? ''} disabled={locked} aria-label="Technician comment" />}</td>
                  <td>{!locked && <input type="checkbox" name={`void_${u.eventId}`} aria-label="Void this unit" />}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        <p className="small">Replacement events can only have their new transmitter ID corrected or be voided (voiding puts the old equipment back on record). To change anything else about a replacement, void it and record it again.</p>
        <div className="field"><label htmlFor="reason">Why is this change needed? (required)</label><input id="reason" name="reason" required /></div>
        <div className="actions"><button type="submit">Save corrections</button> <a className="btn secondary" href={`/visits/${id}`}>Cancel</a></div>
      </form>
    </>
  );
}
