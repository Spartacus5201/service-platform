import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireSession } from '@/src/server/session';
import { today } from '@/src/server/dates';
import { can } from '@/src/auth/auth';
import { CHARGE_CODES, laborRate, quoteStatus } from '@/src/documents/build';
import { documentTotal, renderDocumentHtml, type FrozenContent } from '@/src/documents/render';
import { catalogItems } from '@/src/server/queries';
import { newVersionAction, reconfirmAction, saveLinesAction } from '../../server-actions/documents';
import { Badge, Flash, money, one, type SP } from '../../ui';

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const s = await requireSession();
  const { id } = await params; const sp = await searchParams;
  const db = await getDb();
  const d = (await db.query<{ id: string; type: string; number: string; title: string | null; property_id: string; property: string; salesforce_case: string | null; salesforce_work_order: string | null;
    quote_valid_until: string | null; price_reconfirmed_on: string | null; acts_as: string[] | null; charge_code: string | null; addressee: string | null; notes: string | null; shipping: string | null; prepared_by: string | null }>(
    `SELECT d.id,d.type,d.number,d.title,d.property_id,p.name property,d.salesforce_case,d.salesforce_work_order,d.quote_valid_until::text,d.price_reconfirmed_on::text,d.acts_as,d.charge_code,d.addressee,d.notes,d.shipping::text,d.prepared_by
       FROM document d JOIN property p ON p.id=d.property_id WHERE d.id=$1`, [id])).rows[0];
  if (!d) notFound();
  const versions = (await db.query<{ id: string; version: number; status: string; issued_at: string | null; frozen: FrozenContent | null }>(
    `SELECT id,version,status,issued_at::text,frozen_content frozen FROM document_version WHERE document_id=$1 ORDER BY version DESC`, [id])).rows;
  const wanted = Number(one(sp.v));
  const v = versions.find((x) => x.version === wanted) ?? versions[0];
  const latest = versions[0];
  // Without document.view a person (a technician) sees only issued versions, as the technician copy.
  const tech = !can(s, 'document.view');
  const canEdit = can(s, 'document.draft'); const canPrice = can(s, 'price.view') && !tech; const canSetPrice = can(s, 'price.edit') && !tech;
  if (tech && !versions.some((x) => x.status === 'issued')) notFound();
  const qs = canPrice ? await quoteStatus(db, id, today()) : 'not_applicable';
  const base = `/documents/${id}`;
  const job = (await db.query<{ id: string; number: number }>(`SELECT j.id, j.number FROM job j JOIN document d ON d.job_id=j.id WHERE d.id=$1`, [id])).rows[0];
  const linked = (await db.query<{ id: string; visited_on: string }>(`SELECT id, visited_on::text FROM visit WHERE document_id=$1 ORDER BY visited_on`, [id])).rows;
  const isDraft = v.status === 'draft';

  let lines: { id: string; building: string | null; unit: string | null; address: string | null; issue_code: string | null; description: string; quantity: string; unit_price: string | null; labor_price: string | null; labor_covered: boolean; part_covered: boolean; include: boolean }[] = [];
  let catalog: Awaited<ReturnType<typeof catalogItems>> = [];
  if (isDraft && canEdit) {
    lines = (await db.query<(typeof lines)[number]>(
      `SELECT l.id, b.label building, u.current_label unit, u.service_address address, l.issue_code, l.description, l.quantity::text, l.unit_price::text, l.labor_price::text, l.labor_covered, l.part_covered, l.include
         FROM document_line l LEFT JOIN endpoint e ON e.id=l.endpoint_id LEFT JOIN unit u ON u.id=e.unit_id LEFT JOIN building b ON b.id=u.building_id
        WHERE l.version_id=$1 ORDER BY b.label NULLS LAST, u.current_label NULLS LAST, l.id`, [v.id])).rows;
    if (canSetPrice) catalog = await catalogItems(db);
  }
  const laborDefault = isDraft && canEdit && canSetPrice ? await laborRate(db) : 0;
  const frozen = v.frozen;
  const total = frozen && canPrice ? documentTotal(frozen) : null;

  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${d.property_id}`}>{d.property}</a>{job && <> / <a href={`/jobs/${job.id}`}>Job #{job.number}</a></>} / {d.number}</div>
      <h1>{d.type} {d.number} <span className="small">{d.title ?? ''}</span></h1>
      <p className="sub">
        Version {v.version} <Badge tone={v.status === 'issued' ? 'ok' : 'warn'}>{v.status}</Badge>
        {d.acts_as?.length ? ` · acts as ${d.acts_as.join(' + ')}` : ''}
        {d.quote_valid_until && canPrice ? ` · quote valid until ${d.quote_valid_until}` : ''}{' '}
        {qs === 'expired' && <Badge tone="bad">quote expired</Badge>}{qs === 'reconfirmed' && <Badge tone="info">pricing reconfirmed {d.price_reconfirmed_on}</Badge>}
        {d.salesforce_case ? ` · Case ${d.salesforce_case}` : ''}{d.salesforce_work_order ? ` · WO ${d.salesforce_work_order}` : ''}
      </p>
      {canEdit && linked.length > 0 && <p className="small">Visits on this {d.type}: {linked.map((x, k) => <span key={x.id}>{k ? ', ' : ''}<a href={`/visits/${x.id}`}>{x.visited_on}</a></span>)} · <a href={`/aar?document=${id}`} target="_blank">After Action Report PDF</a></p>}
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      {versions.length > 1 && !tech && (
        <div className="filters">{versions.map((x) => <a key={x.id} className={x.id === v.id ? 'on' : ''} href={`${base}?v=${x.version}`}>v{x.version} {x.status}</a>)}</div>
      )}

      {isDraft && canEdit && (
        <form action={saveLinesAction}>
          <input type="hidden" name="document_id" value={id} /><input type="hidden" name="version_id" value={v.id} />
          <div className="card">
            <div className="row">
              <div className="field" style={{ flex: 2 }}><label htmlFor="title">Project name</label><input id="title" name="title" defaultValue={d.title ?? ''} /></div>
              <div className="field"><label htmlFor="charge_code">Charge code</label><select id="charge_code" name="charge_code" defaultValue={d.charge_code ?? '20'}>{Object.entries(CHARGE_CODES).map(([k, v]) => <option key={k} value={k}>{k} - {v}</option>)}</select></div>
              <div className="field"><label htmlFor="salesforce_case">Salesforce Case</label><input id="salesforce_case" name="salesforce_case" defaultValue={d.salesforce_case ?? ''} /></div>
              <div className="field"><label htmlFor="salesforce_work_order">Work Order</label><input id="salesforce_work_order" name="salesforce_work_order" defaultValue={d.salesforce_work_order ?? ''} /></div>
            </div>
            <div className="row">
              {d.type === 'Proposal' && <div className="field" style={{ flex: 2 }}><label htmlFor="addressee">Submitted to (one line per row)</label><textarea id="addressee" name="addressee" defaultValue={d.addressee ?? ''} /></div>}
              <div className="field" style={{ flex: 2 }}><label htmlFor="notes">Notes under the items</label><textarea id="notes" name="notes" defaultValue={d.notes ?? ''} /></div>
              {d.type === 'Proposal' && canSetPrice && <div className="field"><label htmlFor="shipping">Shipping &amp; handling</label><input id="shipping" className="num" name="shipping" inputMode="decimal" defaultValue={d.shipping ?? ''} /></div>}
              {d.type === 'Proposal' && <div className="field"><label htmlFor="prepared_by">Prepared by</label><input id="prepared_by" className="num" name="prepared_by" maxLength={4} defaultValue={d.prepared_by ?? ''} placeholder="initials" /></div>}
            </div>
          </div>
          <div className="tablewrap"><table>
            <thead><tr><th>Incl.</th><th>Unit</th><th>Address</th><th>Issue</th><th>Work</th><th className="n">Qty</th>{canPrice && <th className="n">Part price</th>}{canPrice && <th className="n">Labor</th>}<th>Labor warr.</th><th>Part warr.</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className={l.include ? '' : 'muted'}>
                  <td><input type="hidden" name="line" value={l.id} /><input type="checkbox" name={`inc_${l.id}`} defaultChecked={l.include} aria-label="Include" /></td>
                  <td className="nowrap">{[l.building, l.unit].filter(Boolean).join('-') || '—'}</td><td className="small">{l.address ?? ''}</td><td>{l.issue_code ?? ''}</td>
                  <td><input name={`desc_${l.id}`} defaultValue={l.description} aria-label="Work" /></td>
                  <td className="n"><input className="num" name={`qty_${l.id}`} defaultValue={l.quantity} aria-label="Quantity" /></td>
                  {canPrice && <td className="n">{canSetPrice ? <input className="num" name={`price_${l.id}`} defaultValue={l.unit_price ?? ''} aria-label="Price" /> : money(l.unit_price === null ? null : Number(l.unit_price))}</td>}
                  {canPrice && <td className="n">{canSetPrice ? <input className="num" name={`laborprice_${l.id}`} defaultValue={l.labor_price ?? ''} aria-label="Labor price" /> : money(l.labor_price === null ? null : Number(l.labor_price))}</td>}
                  <td><input type="checkbox" name={`labor_${l.id}`} defaultChecked={l.labor_covered} aria-label="Labor covered" /></td>
                  <td><input type="checkbox" name={`part_${l.id}`} defaultChecked={l.part_covered} aria-label="Part covered" /></td>
                </tr>
              ))}
              {!lines.length && <tr><td colSpan={10} className="small">No lines yet. Add one below.</td></tr>}
            </tbody>
          </table></div>
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 style={{ marginTop: 0 }}>Add a line</h2>
            <div className="row">
              {canSetPrice && <div className="field"><label htmlFor="new_item">From the catalog</label>
                <select id="new_item" name="new_item" defaultValue=""><option value="">(none)</option>{[...new Set(catalog.map((c) => c.part_type ?? c.kind))].map((g) => (
                  <optgroup key={g} label={g}>{catalog.filter((c) => (c.part_type ?? c.kind) === g).map((c) => <option key={c.id} value={c.id}>{c.name}{c.price ? ` — ${money(Number(c.price))}` : ''}</option>)}</optgroup>))}</select></div>}
              <div className="field" style={{ flex: 2 }}><label htmlFor="new_desc">Description</label><input id="new_desc" name="new_desc" /></div>
              <div className="field"><label htmlFor="new_qty">Qty</label><input id="new_qty" className="num" name="new_qty" defaultValue="1" /></div>
              {canSetPrice && <div className="field"><label htmlFor="new_price">Part price</label><input id="new_price" className="num" name="new_price" /></div>}
              {canSetPrice && <div className="field"><label htmlFor="new_labor">Labor</label><input id="new_labor" className="num" name="new_labor" defaultValue={laborDefault} /></div>}
            </div>
            <p className="small" style={{ margin: 0 }}>Coverage is shown here only as a starting point. Both copies, client and technician, are produced when you issue.</p>
          </div>
          <div className="actions">
            <button type="submit">Save draft</button>
            <button type="submit" name="intent" value="issue">Save and issue</button>
          </div>
        </form>
      )}

      {isDraft && !canEdit && <div className="flash">This version is still a draft.</div>}

      {!isDraft && frozen && (
        <>
          <div className="stats">
            <div className="stat"><b>{frozen.lines.filter((l) => l.include).length}</b><span>lines</span></div>
            {total !== null && <div className="stat"><b>{money(total)}</b><span>total</span></div>}
            <div className="stat"><b>{frozen.issuedOn}</b><span>issued</span></div>
          </div>
          <div className="grid">
            {!tech && canPrice && <div><h2 style={{ marginTop: 0 }}>Client copy</h2><iframe className="copy" title="Client copy" sandbox="" srcDoc={renderDocumentHtml(frozen, 'client')} /></div>}
            <div><h2 style={{ marginTop: 0 }}>Technician copy</h2><iframe className="copy" title="Technician copy" sandbox="" srcDoc={renderDocumentHtml(frozen, 'tech')} /></div>
          </div>
          <div className="actions">
            {!tech && canPrice && <a className="btn secondary" href={`${base}/pdf?v=${v.version}&copy=client`} target="_blank">Client PDF</a>}
            <a className="btn secondary" href={`${base}/pdf?v=${v.version}&copy=tech`} target="_blank">Technician PDF</a>
            {canEdit && v.id === latest.id && <form action={newVersionAction}><input type="hidden" name="document_id" value={id} /><button className="secondary" type="submit">Start a new version</button></form>}
            {canSetPrice && qs === 'expired' && <form action={reconfirmAction}><input type="hidden" name="document_id" value={id} /><button type="submit">Reconfirm pricing</button></form>}
          </div>
        </>
      )}
    </>
  );
}
