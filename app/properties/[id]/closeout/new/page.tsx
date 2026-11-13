import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { today } from '@/src/server/dates';
import { getProperty } from '@/src/server/queries';
import { auditLines, needsAction } from '@/src/queries/audit';
import { createCloseoutAction } from '../../../../actions';
import { Flash, one, type SP } from '../../../../ui';

const ACTIONS = [['inspect_test', 'Inspect / test'], ['repair', 'Repair'], ['replace', 'Replace'], ['reprogram', 'Reprogram'], ['other', 'Other']];
const RESULTS = [['', '(from action)'], ['repaired', 'Repaired'], ['replaced', 'Replaced'], ['reprogrammed', 'Reprogrammed'], ['no_fault_found', 'No fault found'], ['unable_to_access', 'Unable to access'], ['unable_to_complete', 'Unable to complete'], ['other', 'Other']];

export default async function NewCloseout({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireCan('edit_documents');
  const { id } = await params; const sp = await searchParams;
  const db = await getDb();
  const p = await getProperty(db, id); if (!p) notFound();
  const batch = (await db.query<{ id: string; imported_at: string }>(
    `SELECT id, imported_at::text FROM import_batch WHERE property_id=$1 AND kind IN ('auto_audit','manual_audit') ORDER BY imported_at DESC LIMIT 1`, [id])).rows[0];
  const lines = batch ? needsAction(await auditLines(db, batch.id, today())) : [];
  const docs = (await db.query<{ id: string; number: string; type: string; title: string | null; issued: boolean }>(
    `SELECT d.id, d.number, d.type, d.title, EXISTS (SELECT 1 FROM document_version v WHERE v.document_id=d.id AND v.status='issued') issued
       FROM document d WHERE d.property_id=$1 AND d.type IN ('WA','Proposal') ORDER BY d.created_on DESC, d.created_at DESC`, [id])).rows;
  const preferred = docs.find((d) => d.issued)?.id ?? '';
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${id}`}>{p.name}</a> / New close-out</div>
      <h1>Record service report</h1>
      <p className="sub">Enter what the technician reported. Units start from the latest audit{batch ? ` (${batch.imported_at.slice(0, 10)})` : ''}; untick any that were not serviced. Wording for the client is reviewed on the next screen.</p>
      <Flash error={one(sp.error)} />
      <form action={createCloseoutAction}>
        <input type="hidden" name="property_id" value={id} />
        <div className="row">
          <div className="field"><label htmlFor="visited_on">Service date</label><input id="visited_on" name="visited_on" type="date" defaultValue={today()} required /></div>
          <div className="field"><label htmlFor="technician">Technician</label><input id="technician" name="technician" required /></div>
          <div className="field"><label htmlFor="outcome">Visit outcome</label>
            <select id="outcome" name="outcome"><option value="completed">Completed</option><option value="unable_to_access">Unable to access</option><option value="unable_to_complete">Unable to complete</option></select></div>
          <div className="field"><label htmlFor="document_id">Work authorization</label>
            <select id="document_id" name="document_id" defaultValue={preferred}><option value="">None (no WA)</option>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.type} {d.number}{d.title ? ` · ${d.title}` : ''}{d.issued ? '' : ' (draft)'}</option>)}</select></div>
          <div className="field"><label htmlFor="salesforce_case">Salesforce case</label><input id="salesforce_case" name="salesforce_case" /></div>
          <div className="field"><label htmlFor="salesforce_work_order">Work order</label><input id="salesforce_work_order" name="salesforce_work_order" /></div>
        </div>
        <div className="field"><label htmlFor="visit_notes">Technician's overall notes (internal)</label><textarea id="visit_notes" name="visit_notes" rows={2} /></div>
        {lines.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Done</th><th>Bldg</th><th>Unit</th><th>Issue</th><th>Action</th><th>Result</th><th>Start read</th><th>End read</th><th>New part</th><th>New TX ID</th><th>Technician comment</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.endpointId}>
                  <td><input type="hidden" name="row" value={i} /><input type="hidden" name={`endpoint_${i}`} value={l.endpointId} /><input type="hidden" name={`issue_${i}`} value={l.code} />
                    <input type="checkbox" name={`include_${i}`} defaultChecked aria-label="Serviced" /></td>
                  <td className="nowrap">{l.building}</td><td className="nowrap">{l.unit}</td><td>{l.code}</td>
                  <td><select name={`action_${i}`} defaultValue="inspect_test" aria-label="Action">{ACTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></td>
                  <td><select name={`result_${i}`} aria-label="Result">{RESULTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></td>
                  <td><input className="num" name={`start_${i}`} inputMode="decimal" aria-label="Start read" /></td>
                  <td><input className="num" name={`end_${i}`} inputMode="decimal" aria-label="End read" /></td>
                  <td><select name={`kind_${i}`} aria-label="New part (replace only)"><option value="">—</option><option value="transmitter">Transmitter</option><option value="meter">Meter</option><option value="combo">Combo</option></select></td>
                  <td><input name={`newtx_${i}`} aria-label="New transmitter ID" /></td>
                  <td><input name={`notes_${i}`} aria-label="Technician comment" /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <div className="card">No audit with units needing action. Record single units from the unit's own page.</div>}
        <p className="small">Choose "Replace" and a new part for units where equipment was swapped; the new transmitter ID is recorded and feeds the billing ID update.</p>
        <div className="actions"><button type="submit" disabled={!lines.length}>Record and review wording</button></div>
      </form>
    </>
  );
}
