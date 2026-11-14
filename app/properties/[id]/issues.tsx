import type { ImportIssue } from '@/src/import/issues';
import { resolveIssueAction } from '../../actions';
import { us } from '../../ui';

/** Open import problems for one property, each with what can be done about it. */
export function ImportIssues({ issues, propertyId, back }: { issues: ImportIssue[]; propertyId: string; back: string }) {
  if (!issues.length) return null;
  return (
    <section id="import-problems" className="card" style={{ marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>Import problems to resolve <span className="small">({issues.length})</span></h2>
      <p className="small" style={{ marginTop: 0 }}>Found by imports and kept until dealt with. They clear themselves when the records catch up (unit added, swap recorded).</p>
      <div className="tablewrap"><table>
        <thead><tr><th>Unit</th><th>Problem</th><th>Found</th><th>Do</th></tr></thead>
        <tbody>{issues.map((i) => (
          <tr key={i.id}>
            <td className="nowrap">{i.building}-{i.unit} {i.service}</td>
            <td>{i.kind === 'unmatched_unit' ? 'Not in the registry; its readings were skipped.' : i.kind === 'id_elsewhere' ? <>The file gives this unit transmitter <b>{i.now}</b>, which is on record at <b>{i.was}</b>. It was not moved. Check which unit it is really on, then record the swap or correct the record.</> : <>Transmitter ID in the file is <b>{i.now}</b>, record has <b>{i.was}</b>. Record the swap as a service visit, or correct the record.</>}</td>
            <td className="small nowrap">{us(i.createdOn)}{i.filename ? <><br />{i.filename}</> : null}</td>
            <td>
              <form action={resolveIssueAction} className="row" style={{ gap: '.4rem', alignItems: 'end' }}>
                <input type="hidden" name="issue_id" value={i.id} /><input type="hidden" name="back" value={back} />
                {i.kind === 'unmatched_unit'
                  ? <button type="submit" name="do" value="add" className="secondary">Add unit</button>
                  : <a className="btn secondary" href={`/properties/${propertyId}/closeout/new`}>Record swap</a>}
                <input name="reason" placeholder="Reason to dismiss" aria-label="Reason to dismiss" style={{ minWidth: '10rem' }} />
                <button type="submit" name="do" value="dismiss" className="secondary">Dismiss</button>
              </form>
            </td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}
