import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { getProperty } from '@/src/server/queries';
import { laborRate } from '@/src/documents/build';
import { uninvoicedEvents } from '@/src/billing/invoice';
import { submitInvoiceAction } from '../../../actions';
import { Badge, Flash, money, one, type SP } from '../../../ui';

export default async function Invoicing({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  await requireCan('edit_prices');
  const { id } = await params; const sp = await searchParams;
  const db = await getDb();
  const p = await getProperty(db, id); if (!p) notFound();
  const events = await uninvoicedEvents(db, id);
  const laborDefault = await laborRate(db);
  const past = (await db.query<{ id: string; submitted_on: string; external_ref: string | null; lines: string; total: string | null }>(
    `SELECT s.id, s.submitted_on::text, s.external_ref, (SELECT count(*) FROM invoice_line l WHERE l.submission_id=s.id) lines,
            (SELECT sum(l.amount)::text FROM invoice_line l WHERE l.submission_id=s.id) total
       FROM invoice_submission s WHERE s.property_id=$1 ORDER BY s.submitted_on DESC, s.created_at DESC LIMIT 20`, [id]).catch(() => ({ rows: [] }))).rows;
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${id}`}>{p.name}</a> / Invoicing</div>
      <h1>Invoicing</h1>
      <p className="sub">Completed service not yet sent to admin. Warranty-covered work is recorded as not billable unless you override it with a reason. Labor starts at the default charge and can be changed per line; part amounts are entered by hand.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      {events.length ? (
        <form action={submitInvoiceAction}>
          <input type="hidden" name="property_id" value={id} />
          <div className="tablewrap"><table>
            <thead><tr><th>Send</th><th>Date</th><th>Unit</th><th>Work</th><th>Coverage</th><th className="n">Labor $</th><th>Parts</th><th>Override</th><th>Reason</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.eventId}>
                  <td><input type="checkbox" name="event" value={e.eventId} defaultChecked aria-label="Include" /></td>
                  <td className="nowrap">{e.visitedOn}</td><td className="nowrap">{e.building}-{e.unit} {e.service}</td>
                  <td>{e.action.replace('_', '/')}{e.issueCode ? ` (${e.issueCode})` : ''}<div className="small">{[e.salesforceCase && `Case ${e.salesforceCase}`, e.salesforceWorkOrder && `WO ${e.salesforceWorkOrder}`].filter(Boolean).join(' · ')}</div></td>
                  <td>{e.partCovered ? <Badge tone="ok">parts + labor</Badge> : e.laborCovered ? <Badge tone="info">labor</Badge> : <Badge>billable</Badge>}</td>
                  <td className="n"><input className="num" name={`labor_${e.eventId}`} inputMode="decimal" defaultValue={laborDefault} aria-label="Labor amount" /></td>
                  <td>{e.parts.map((q) => (
                    <div key={q.partId} className="nowrap small"><input type="hidden" name={`parts_${e.eventId}`} value={q.partId} />{q.quantity}× {q.catalogName ?? q.model ?? q.kind}{' '}
                      <input className="num" name={`part_${q.partId}`} inputMode="decimal" defaultValue={q.catalogPrice ?? 0} aria-label="Part amount" /></div>
                  ))}{!e.parts.length && <span className="small">—</span>}</td>
                  <td>{(e.laborCovered || e.partCovered) ? <input type="checkbox" name={`override_${e.eventId}`} aria-label="Bill anyway" /> : null}</td>
                  <td>{(e.laborCovered || e.partCovered) ? <input name={`reason_${e.eventId}`} aria-label="Override reason" /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="row" style={{ marginTop: '.75rem' }}>
            <div className="field"><label htmlFor="external_ref">Reference (admin ticket or invoice no.)</label><input id="external_ref" name="external_ref" /></div>
          </div>
          <div className="actions"><button type="submit">Record invoicing report</button></div>
        </form>
      ) : <div className="card">Nothing to invoice.</div>}
      <h2>Past submissions</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Date</th><th>Reference</th><th className="n">Lines</th><th className="n">Total</th></tr></thead>
        <tbody>
          {past.map((x) => <tr key={x.id}><td>{x.submitted_on}</td><td>{x.external_ref ?? '—'}</td><td className="n">{x.lines}</td><td className="n">{money(x.total === null ? null : Number(x.total))}</td></tr>)}
          {!past.length && <tr><td colSpan={4} className="small">None yet.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
