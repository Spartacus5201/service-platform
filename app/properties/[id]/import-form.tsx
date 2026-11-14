'use client';
import { useActionState, useEffect } from 'react';
import { importReport } from '../../actions';
import type { ImportUi } from '../../types';

const KIND: Record<string, string> = {
  auto_audit: 'Auto Audit', manual_audit: 'Manual Audit', occupancy: 'Occupancy report', cim_nextcentury: 'CIM (NextCentury / Zenner)', cim_inovonics: 'CIM (Inovonics)', psr: 'PSR',
};

export default function ImportForm({ propertyId, firstImport }: { propertyId: string; firstImport: boolean }) {
  const [r, action, pending] = useActionState<ImportUi, FormData>(importReport, {});
  useEffect(() => { if (r.wizardUrl) window.location.assign(r.wizardUrl); }, [r.wizardUrl]);
  return (
    <form action={action} className="card">
      <h2 style={{ marginTop: 0 }}>Import a report</h2>
      <p className="small" style={{ marginTop: 0 }}>Auto Audit, Manual Audit, CIM (NextCentury, Zenner, Inovonics), PSR, AMR Status Report or Unit Directory are detected from the file. Any other report opens the import wizard, where its columns are mapped once and remembered.</p>
      <input type="hidden" name="property_id" value={propertyId} />
      <div className="row">
        <div className="field" style={{ flex: 2 }}><label htmlFor="file">Report file (.xlsx or .csv)</label><input id="file" name="file" type="file" accept=".xlsx,.csv,.tsv,.txt" required /></div>
        <div className="field">
          <label htmlFor="purpose">Use this file as</label>
          <select id="purpose" name="purpose" defaultValue="report">
            <option value="report">The report it is</option>
            <option value="occupancy">Occupancy only (ignore reads and AuditResult)</option>
          </select>
        </div>
      </div>
      <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
        <input type="checkbox" name="create_missing" defaultChecked={firstImport} /> Add units and endpoints this property does not have yet {firstImport && <span className="small">(first import)</span>}
      </label>
      <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
        <input type="checkbox" name="wizard" /> Open in the import wizard (check or change how the columns are read)
      </label>
      {r.wizardUrl && <div className="flash" role="status">Opening the import wizard… <a href={r.wizardUrl}>Continue</a></div>}
      <div className="actions"><button type="submit" disabled={pending}>{pending ? 'Importing…' : 'Import'}</button></div>

      {r.error && <div className="flash error" role="alert" style={{ marginTop: '.75rem' }}>{r.error}</div>}
      {r.kind && !r.error && (
        <div style={{ marginTop: '.75rem' }} role="status">
          <div className={`flash ${r.duplicate ? '' : 'ok'}`}>
            {r.duplicate ? 'This exact file was already imported. Nothing changed.' : `Imported as ${KIND[r.kind] ?? r.kind}.`}
          </div>
          {!r.duplicate && (
            <div className="stats">
              {r.rows !== undefined && <div className="stat"><b>{r.rows}</b><span>rows read</span></div>}
              {!!r.readings && <div className="stat"><b>{r.readings}</b><span>readings stored</span></div>}
              {!!r.occupancyUpdated && <div className="stat"><b>{r.occupancyUpdated}</b><span>occupancy updated</span></div>}
              {!!r.checkins && <div className="stat"><b>{r.checkins}</b><span>check-ins</span></div>}
              {!!r.devices && <div className="stat"><b>{r.devices}</b><span>new devices</span></div>}
              {!!r.unitsCreated && <div className="stat"><b>{r.unitsCreated}</b><span>units added</span></div>}
            </div>
          )}
          {r.auditUrl && <p><a className="btn" href={r.auditUrl}>Open the audit review →</a></p>}
          {!!r.unmatched?.length && (
            <div className="flash error"><b>{r.unmatched.length} unit(s) are not in the registry</b> and were skipped: {r.unmatched.slice(0, 12).map((u) => `${u.building}-${u.unit} ${u.service}`).join(', ')}{r.unmatched.length > 12 ? '…' : ''}. Tick “Add units” and import again if they are new, or deal with them under Import problems.</div>
          )}
          {!!r.idChanges?.length && (
            <div className="flash"><b>{r.idChanges.length} transmitter ID(s) differ from the record</b> and were not changed. Record the swap as a service visit to update them (kept under Import problems until then): {r.idChanges.slice(0, 8).map((c) => `${c.building}-${c.unit} (${c.was} → ${c.now})`).join(', ')}{r.idChanges.length > 8 ? '…' : ''}</div>
          )}
          {!!r.idElsewhere?.length && (
            <div className="flash error"><b>{r.idElsewhere.length} transmitter ID(s) are on record at a different unit</b> and were not moved (kept under Import problems): {r.idElsewhere.slice(0, 8).map((c) => `${c.building}-${c.unit} has ${c.hardwareId}, on record at ${c.at}`).join('; ')}{r.idElsewhere.length > 8 ? '…' : ''}</div>
          )}
          {!!r.warnings?.length && <details><summary className="small">{r.warnings.length} note(s)</summary><ul>{r.warnings.map((w, i) => <li key={i} className="small">{w}</li>)}</ul></details>}
        </div>
      )}
    </form>
  );
}
