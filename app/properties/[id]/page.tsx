import { followUps } from '@/src/service/verify';
import { stagedLines, latestAuditBatch, countStages, STAGE_LABEL, type UnitStage } from '@/src/service/unitstatus';
import { today } from '@/src/server/dates';
import { lowBatteryDevices } from '@/src/service/battery';
import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { getProperty, propertyDocuments, propertyImports, propertyUnits } from '@/src/server/queries';
import { saveSystemNotesAction, updateProperty } from '../../actions';
import { BRANDS, MILESTONES, PRICE_ITEMS, UTILITIES, equipmentText, getPropertyPrices, getSystemNotes } from '@/src/documents/systemnotes';
import { Badge, Flash, one, type SP } from '../../ui';
import ImportForm from './import-form';

const KIND: Record<string, string> = { auto_audit: 'Auto Audit', manual_audit: 'Manual Audit', occupancy: 'Occupancy', unit_directory: 'Unit Directory', cim_nextcentury: 'CIM', cim_inovonics: 'CIM (Inovonics)', psr: 'PSR' };

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const s = await requireSession();
  const { id } = await params; const sp = await searchParams;
  const db = await getDb();
  const p = await getProperty(db, id);
  if (!p) notFound();
  const [units, imports, docs] = await Promise.all([propertyUnits(db, id), propertyImports(db, id), propertyDocuments(db, id)]);
  const canImport = can(s.role, 'import_reports'); const canDocs = can(s.role, 'edit_documents'); const canInvoice = can(s.role, 'edit_prices');
  const [sys, propPrices] = await Promise.all([getSystemNotes(db, id), getPropertyPrices(db, id)]);
  const priceRows = [...Object.entries(propPrices), ['', ''], ['', '']].slice(0, Math.max(3, Object.keys(propPrices).length + 1));
  const visits = canDocs ? (await db.query<{ id: string; visited_on: string; technician: string | null; notes_status: string; units: string }>(
    `SELECT v.id, v.visited_on::text, v.technician, v.notes_status, (SELECT count(*) FROM service_event se WHERE se.visit_id=v.id)::text units FROM visit v WHERE v.property_id=$1 ORDER BY v.visited_on DESC, v.created_at DESC LIMIT 15`, [id])).rows : [];
  const fups = canDocs ? await followUps(db, id) : [];
  const latest = await latestAuditBatch(db, id);
  const lowCount = canDocs ? (await lowBatteryDevices(db, { propertyId: id })).length : 0;
  const stages = latest ? countStages(await stagedLines(db, latest.id, today())) : null;
  const vacant = units.filter((u) => u.occupancyKnown && !u.moveInOn).length;
  const showPrices = can(s.role, 'view_prices');
  void showPrices;
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / {p.name}</div>
      <h1>{p.name} <span className="small">ClassID {p.class_id}</span></h1>
      <p className="sub">{p.address ?? 'No address yet'} · {p.installed_by_us ? `Installed by us${p.install_completed_on ? `, completed ${p.install_completed_on}` : ''}` : 'Not installed by us (no install warranty)'}</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <div className="stats">
        <div className="stat"><b>{units.length}</b><span>endpoints</span></div>
        <div className="stat"><b>{vacant}</b><span>vacant units</span></div>
        <div className="stat"><b>{units.filter((u) => u.isManual).length}</b><span>manual-read</span></div>
        <div className="stat"><b>{docs.length}</b><span>documents</span></div>
      </div>
      {stages && latest && Object.values(stages).some(Boolean) && (
        <p className="small">Latest audit ({latest.on}), flagged units: {(Object.keys(stages) as UnitStage[]).filter((k) => stages[k]).map((k) => `${STAGE_LABEL[k]} ${stages[k]}`).join(' · ')} · <a href={`/properties/${id}/audits/${latest.id}`}>open audit</a></p>
      )}
      {canInvoice && <p><a className="btn secondary" href={`/properties/${id}/invoicing`}>Invoicing →</a></p>}
      {canDocs && <p><a className="btn secondary" href={`/properties/${id}/closeout/new`}>Record service report →</a> <a className="btn secondary" href={`/properties/${id}/battery`}>Low battery report{lowCount ? ` (${lowCount})` : ''} →</a></p>}

      {canImport && <ImportForm propertyId={id} firstImport={units.length === 0} />}

      <h2>Imports</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>When</th><th>Report</th><th>File</th><th>Summary</th><th>Raw file</th><th></th></tr></thead>
        <tbody>
          {imports.map((i) => (
            <tr key={i.id}>
              <td className="nowrap">{i.imported_at.slice(0, 16).replace('T', ' ')}</td><td>{KIND[i.kind] ?? i.kind}</td><td>{i.filename ?? '—'}</td>
              <td className="small">{[i.summary.readings && `${i.summary.readings} readings`, i.summary.occupancyUpdated && `${i.summary.occupancyUpdated} occupancy`, i.summary.checkins && `${i.summary.checkins} check-ins`, i.summary.unitsCreated && `${i.summary.unitsCreated} units added`].filter(Boolean).join(' · ') || '—'}</td>
              <td className="small">{i.raw_file ? `kept until ${i.purge_after}` : 'discarded'}</td>
              <td>{(i.kind === 'auto_audit' || i.kind === 'manual_audit') && <a href={`/properties/${id}/audits/${i.id}`}>Review →</a>}</td>
            </tr>
          ))}
          {!imports.length && <tr><td colSpan={6} className="small">Nothing imported yet.</td></tr>}
        </tbody>
      </table></div>

      {fups.length > 0 && <>
        <h2>Needs follow-up</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Unit</th><th>Last service</th><th>Why</th></tr></thead>
          <tbody>{fups.map((f) => <tr key={f.eventId}><td className="nowrap"><a href={`/endpoints/${f.endpointId}`}>{f.building}-{f.unit} {f.service}</a></td><td className="nowrap"><a href={`/visits/${f.visitId}`}>{f.visitedOn}</a></td><td className="small">{f.evidence}</td></tr>)}</tbody>
        </table></div>
      </>}

      {canDocs && <>
        <h2>Service notes</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Service date</th><th>Technician</th><th className="n">Units</th><th>Status</th></tr></thead>
          <tbody>
            {visits.map((v) => <tr key={v.id}><td><a href={`/visits/${v.id}`}>{v.visited_on}</a></td><td>{v.technician ?? '—'}</td><td className="n">{v.units}</td><td><Badge tone={v.notes_status === 'approved' ? 'ok' : 'warn'}>{v.notes_status}</Badge></td></tr>)}
            {!visits.length && <tr><td colSpan={4} className="small">No service reports yet.</td></tr>}
          </tbody>
        </table></div>
      </>}

      <h2>Documents</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Number</th><th>Type</th><th>Title</th><th>Case</th><th>Version</th><th>Quote valid until</th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}><td><a href={`/documents/${d.id}`}>{d.number}</a></td><td>{d.type}</td><td>{d.title ?? '—'}</td><td>{d.salesforce_case ?? '—'}</td>
              <td>v{d.version} <Badge tone={d.status === 'issued' ? 'ok' : 'warn'}>{d.status}</Badge></td><td>{d.quote_valid_until ?? '—'}</td></tr>
          ))}
          {!docs.length && <tr><td colSpan={6} className="small">No documents yet. Start one from an audit review{canDocs ? ' or build an RFM below' : ''}.</td></tr>}
        </tbody>
      </table></div>
      {canDocs && (
        <form action={(await import('../../actions')).createDocumentAction} className="card" style={{ marginTop: '1rem' }}>
          <input type="hidden" name="property_id" value={id} />
          <div className="row">
            <div className="field"><label htmlFor="type">New document</label><select id="type" name="type"><option value="RFM">RFM (material only)</option><option value="Proposal">Proposal</option><option value="WA">Work Authorization</option></select></div>
            <div className="field" style={{ flex: 2 }}><label htmlFor="title">Title</label><input id="title" name="title" /></div>
            <div className="field"><button type="submit">Start blank document</button></div>
          </div>
        </form>
      )}

      <h2>Units and endpoints</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Bldg</th><th>Unit</th><th>Address</th><th>Service</th><th>Transmitter</th><th>Occupancy</th><th>Last check-in</th></tr></thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.endpointId}>
              <td>{u.building}</td><td><a href={`/endpoints/${u.endpointId}`}>{u.unit}</a></td><td>{u.address ?? '—'}</td>
              <td>{u.service} {u.isManual && <Badge tone="info">manual</Badge>}</td><td>{u.transmitter ?? '—'}</td>
              <td>{!u.occupancyKnown ? <Badge>unknown</Badge> : u.moveInOn ? <Badge tone="ok">since {u.moveInOn}</Badge> : <Badge tone="warn">vacant</Badge>}</td>
              <td className="small">{u.lastCheckIn ? u.lastCheckIn.slice(0, 16).replace('T', ' ') : '—'}</td>
            </tr>
          ))}
          {!units.length && <tr><td colSpan={7} className="small">No units yet. Import an audit with “Add units” ticked.</td></tr>}
        </tbody>
      </table></div>

      {canDocs && (
        <form action={saveSystemNotesAction} className="card" style={{ marginTop: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>WA Notes</h2>
          <p className="small">How this property&rsquo;s system is set up and what the technician needs. Printed on the technician copy of every WA and RFM, never on the client copy.</p>
          <input type="hidden" name="id" value={id} />
          {[0, 1, 2].map((i) => (
            <div className="row" key={i}>
              <div className="field"><label htmlFor={`utility_${i + 1}`}>Utility {i + 1}</label><select id={`utility_${i + 1}`} name={`utility_${i + 1}`} defaultValue={sys.utilities[i]?.utility ?? ''}><option value=""></option>{UTILITIES.map((u) => <option key={u}>{u}</option>)}</select></div>
              <div className="field" style={{ flex: 2 }}><label htmlFor={`device_${i + 1}`}>Meter / device</label><input id={`device_${i + 1}`} name={`device_${i + 1}`} defaultValue={sys.utilities[i]?.device ?? ''} /></div>
            </div>
          ))}
          <div className="row">
            <div className="field"><label htmlFor="system_brand">System</label><select id="system_brand" name="system_brand" defaultValue={sys.systemBrand ?? ''}><option value=""></option>{BRANDS.map((b) => <option key={b}>{b}</option>)}</select></div>
            <div className="field" style={{ flex: 2 }}><label htmlFor="system_id">Collector / gateway ID</label><input id="system_id" name="system_id" defaultValue={sys.systemId ?? ''} /></div>
            <div className="field" style={{ flex: 2 }}><label htmlFor="collector_location">Location</label><input id="collector_location" name="collector_location" defaultValue={sys.collectorLocation ?? ''} /></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="milestone_kind">Milestone</label><select id="milestone_kind" name="milestone_kind" defaultValue={sys.milestoneKind ?? ''}><option value=""></option>{MILESTONES.map((m) => <option key={m}>{m}</option>)}</select></div>
            <div className="field"><label htmlFor="milestone_on">Date</label><input id="milestone_on" name="milestone_on" type="date" defaultValue={sys.milestoneOn ?? ''} /></div>
            <div className="field"><label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><input type="checkbox" name="msa" defaultChecked={p.msa} /> Meter service agreement (charge code 21)</label></div>
          </div>
          <div className="field"><label htmlFor="tech_note">Technician note</label><textarea id="tech_note" name="tech_note" defaultValue={sys.techNote ?? ''} placeholder="Please check all wiring and replace equipment as needed. Verify transmitting and incrementing before leaving each unit." /></div>
          <div className="row">
            <div className="field"><label htmlFor="transmitter_device">Transmitter to install</label><input id="transmitter_device" name="transmitter_device" defaultValue={sys.transmitterDevice ?? ''} /></div>
            <div className="field"><label htmlFor="meter_device">Meter to install</label><input id="meter_device" name="meter_device" defaultValue={sys.meterDevice ?? ''} /></div>
            <div className="field" style={{ flex: 2 }}><label htmlFor="equipment">Also bring (one per line: quantity | item)</label><textarea id="equipment" name="equipment" defaultValue={equipmentText(sys.equipment)} placeholder="1 | Programmer" /></div>
          </div>
          <p className="small">The technician copy counts transmitters and meters from the document and lists them first, using the names above.</p>
          {canInvoice && (
            <>
              <h3>Prices for this property</h3>
              <p className="small">Replace the catalog price (and the default labor charge) on new documents for this property. Leave empty to use the catalog.</p>
              {priceRows.map(([item, price], i) => (
                <div className="row" key={i}>
                  <div className="field"><label htmlFor={`price_item_${i + 1}`}>Item</label><select id={`price_item_${i + 1}`} name={`price_item_${i + 1}`} defaultValue={item}><option value=""></option>{PRICE_ITEMS.map((x) => <option key={x}>{x}</option>)}</select></div>
                  <div className="field"><label htmlFor={`price_${i + 1}`}>Price</label><input id={`price_${i + 1}`} name={`price_${i + 1}`} className="num" inputMode="decimal" defaultValue={price === '' ? '' : String(price)} /></div>
                </div>
              ))}
            </>
          )}
          <button type="submit">Save WA Notes</button>
        </form>
      )}

      {canImport && (
        <form action={updateProperty} className="card" style={{ marginTop: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>Property details</h2>
          <input type="hidden" name="id" value={id} />
          <div className="row">
            <div className="field" style={{ flex: 2 }}><label htmlFor="name">Name</label><input id="name" name="name" defaultValue={p.name} required /></div>
            <div className="field" style={{ flex: 2 }}><label htmlFor="address">Address</label><input id="address" name="address" defaultValue={p.address ?? ''} /></div>
            <div className="field"><label htmlFor="billing_code">Billing code</label><input id="billing_code" name="billing_code" defaultValue={p.billing_code ?? ''} /></div>
            <div className="field"><label htmlFor="salesforce_account_ref">Salesforce account</label><input id="salesforce_account_ref" name="salesforce_account_ref" defaultValue={p.salesforce_account_ref ?? ''} /></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="city">City</label><input id="city" name="city" defaultValue={p.city ?? ''} /></div>
            <div className="field"><label htmlFor="state">State</label><input id="state" name="state" className="num" defaultValue={p.state ?? ''} /></div>
            <div className="field"><label htmlFor="zip">Zip</label><input id="zip" name="zip" className="num" defaultValue={p.zip ?? ''} /></div>
          </div>
          <div className="row">
            <div className="field"><label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><input type="checkbox" name="installed_by_us" defaultChecked={p.installed_by_us} /> We installed this property</label></div>
            <div className="field"><label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><input type="checkbox" name="billing_contract" defaultChecked={p.billing_contract} /> Has a billing contract (ClassID)</label></div>
            <div className="field"><label htmlFor="install_completed_on">Install completed (warranty start)</label><input id="install_completed_on" name="install_completed_on" type="date" defaultValue={p.install_completed_on ?? ''} /></div>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="access_notes">Access notes (shown on technician copies)</label><textarea id="access_notes" name="access_notes" defaultValue={p.access_notes ?? ''} /></div>
            <div className="field"><label htmlFor="scheduling_notes">Scheduling notes</label><textarea id="scheduling_notes" name="scheduling_notes" defaultValue={p.scheduling_notes ?? ''} /></div>
          </div>
          <div className="actions"><button type="submit">Save details</button></div>
        </form>
      )}
    </>
  );
}
