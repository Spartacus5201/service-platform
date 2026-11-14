import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { getProperty } from '@/src/server/queries';
import { wizardView, WizardError, type WizardView } from '@/src/importer/wizard';
import { TARGETS } from '@/src/importer/targets';
import { wizTableAction, wizTargetAction, wizColumnsAction, wizValuesAction, wizExcludeAction, wizImportAction, wizDiscardAction } from '../../../../server-actions/wizard';
import { Badge, Flash, one, type SP } from '../../../../ui';

const HINT: Record<string, string> = { service: 'Water, Gas or Electric', occupants: 'a number, e.g. 0', battery_level: 'a percent, e.g. 40', move_in: 'a date, e.g. 01/31/2026', move_out: 'a date, e.g. 01/31/2026' };

export default async function ImportWizard({ params, searchParams }: { params: Promise<{ id: string; upload: string }>; searchParams: SP }) {
  await requireCan('import_reports');
  const { id, upload } = await params; const sp = await searchParams;
  const db = await getDb(); const prop = await getProperty(db, id);
  let v: WizardView;
  try { v = await wizardView(db, upload); }
  catch (e) {
    if (!(e instanceof WizardError)) throw e;
    return (<><h1>Import wizard</h1><div className="flash error">{e.message}</div><p><a href={`/properties/${id}`}>Back to {prop?.name ?? 'the property'}</a></p></>);
  }
  const hidden = <><input type="hidden" name="upload_id" value={upload} /><input type="hidden" name="property_id" value={id} /></>;
  const p = v.preview; const fields = v.target ? TARGETS[v.target].fields : [];
  const colOf = (field: string) => p?.columns.find((c) => c.field === field)?.column ?? v.state.overrides.columns?.[field] ?? null;
  const constOf = (field: string) => v.state.overrides.constants?.[field] ?? '';
  const ready = !!p?.importable && !v.state.suggested;
  const stepsDone = [true, !!v.target, !!v.target && !v.state.suggested && !p?.blocking.length, ready];

  return (
    <>
      <h1>Import wizard</h1>
      <p className="sub">{v.upload.filename ?? 'Uploaded file'} for <a href={`/properties/${id}`}>{prop?.name}</a>. Nothing is saved until you press Import.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <ol className="stats" style={{ listStyle: 'none', padding: 0 }}>
        {['The table', 'What it holds', 'Columns', 'Check and import'].map((t, i) => (
          <li key={t} className="stat"><b>{stepsDone[i] ? '✓' : i + 1}</b><span>{t}</span></li>
        ))}
      </ol>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>1. The table</h2>
        <p className="small" style={{ marginTop: 0 }}>Which sheet holds the data, and which row has the column names. Rows above the header (titles, dates) are ignored. Blank lines are not counted.</p>
        <form action={wizTableAction} className="row" style={{ alignItems: 'flex-end' }}>
          {hidden}
          {v.sheets.length > 1 ? (
            <div className="field"><label htmlFor="sheet">Sheet</label>
              <select id="sheet" name="sheet" defaultValue={v.sheet}>{v.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rows} rows)</option>)}</select></div>
          ) : <input type="hidden" name="sheet" value={v.sheet} />}
          <div className="field"><label htmlFor="header_row">Header row</label><input id="header_row" name="header_row" className="num" inputMode="numeric" defaultValue={v.headerRow} /></div>
          <div className="field"><button className="secondary" type="submit">Use this</button></div>
        </form>
        <div className="tablewrap" style={{ maxHeight: '22rem' }}><table>
          <tbody>
            {v.grid.map((r, i) => (
              <tr key={i} style={i + 1 === v.headerRow ? { fontWeight: 600, background: 'var(--info-bg)' } : i + 1 < v.headerRow ? { opacity: 0.55 } : undefined}>
                <td className="small n">{i + 1}</td>{r.map((c, j) => <td key={j} className="small nowrap">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>2. What it holds</h2>
        <form action={wizTargetAction} className="row" style={{ alignItems: 'flex-end' }}>
          {hidden}
          <div className="field" style={{ flex: 3 }}><label htmlFor="choice">This file is</label>
            <select id="choice" name="choice" defaultValue={v.base ? `layout:${v.base.id}` : v.target ? `target:${v.target}` : ''}>
              <option value="" disabled>Choose…</option>
              {v.candidates.length > 0 && <optgroup label="Saved maps that fit this file">
                {v.candidates.map((c) => <option key={c.id} value={`layout:${c.id}`}>{c.name}{c.builtin ? ' (built in)' : ` (version ${c.version})`}{c.score < 1 ? ` — ${Math.round(c.score * 100)}% of its columns found` : ''}</option>)}
              </optgroup>}
              <optgroup label="A new map">
                {Object.values(TARGETS).map((t) => <option key={t.target} value={`target:${t.target}`}>New map: {t.label}</option>)}
              </optgroup>
            </select></div>
          <div className="field"><button className="secondary" type="submit">Choose</button></div>
        </form>
        {v.base && <p className="small">Using <b>{v.base.name}</b>{v.base.builtin ? ' (built in)' : `, version ${v.base.version}`}. Change any column below if this file differs; the change is saved when you import.</p>}
        {!v.base && v.target && <p className="small">A new map for <b>{TARGETS[v.target].label.toLowerCase()}</b>. It is saved under the name you give it, so the next file like this one is recognised.</p>}
      </section>

      {v.target && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>3. Columns</h2>
          {v.state.suggested && <div className="flash">Columns were suggested from the header names. Check every one, then press <b>Use these columns</b>.</div>}
          <form action={wizColumnsAction}>
            {hidden}
            <div className="tablewrap"><table>
              <thead><tr><th>App field</th><th>Column in the file</th><th>Or one value for every row</th><th>First values in that column</th></tr></thead>
              <tbody>
                {fields.map((f) => {
                  const col = colOf(f.key);
                  return (
                    <tr key={f.key}>
                      <td><b>{f.label}</b> {f.required && <Badge tone="warn">required</Badge>}{f.help && <div className="small">{f.help}</div>}</td>
                      <td><select name={`col:${f.key}`} defaultValue={col ?? ''} aria-label={`Column for ${f.label}`}>
                        <option value="">— not in this file —</option>
                        {v.columns.map((c) => <option key={c.n} value={c.n}>{c.n} · {c.header || '(no header)'}</option>)}
                      </select></td>
                      <td><input name={`const:${f.key}`} defaultValue={constOf(f.key)} aria-label={`Fixed value for ${f.label}`} placeholder={HINT[f.key] ?? ''} /></td>
                      <td className="small">{col ? (v.columns[col - 1]?.samples.join(' · ') || '(blank)') : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            {!!p?.unused.length && <p className="small">Not read: {p.unused.join(', ')}.</p>}
            <div className="actions"><button type="submit">Use these columns</button></div>
          </form>
        </section>
      )}

      {p && !v.state.suggested && Object.entries(v.problemValues).map(([field, vals]) => (
        <section className="card" key={field}>
          <h2 style={{ marginTop: 0 }}>Values it cannot read: {fields.find((f) => f.key === field)?.label ?? field}</h2>
          <p className="small" style={{ marginTop: 0 }}>Say how to read each value. The answer is saved with the map, so the same value is read the same way next time.</p>
          <form action={wizValuesAction}>
            {hidden}<input type="hidden" name="field" value={field} />
            <table>
              <thead><tr><th>In the file</th><th className="n">Rows</th><th>Problem</th><th>Read it as</th></tr></thead>
              <tbody>{vals.map((x) => (
                <tr key={x.raw}><td><code>{x.raw}</code></td><td className="n">{x.count}</td><td className="small">{x.message}</td>
                  <td><input name={`as:${x.raw}`} placeholder={HINT[field] ?? ''} aria-label={`Read ${x.raw} as`} /></td></tr>
              ))}</tbody>
            </table>
            <div className="actions"><button className="secondary" type="submit">Read these values this way</button></div>
          </form>
        </section>
      ))}

      {p && !v.state.suggested && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>4. Check and import</h2>
          {!!p.blocking.length && <div className="flash error" role="alert"><b>Cannot import yet:</b><ul style={{ margin: '.3rem 0 0' }}>{p.blocking.map((b) => <li key={b}>{b}</li>)}</ul></div>}
          {!p.blocking.length && (
            <div className="stats">
              <div className="stat"><b>{p.rows.length}</b><span>rows to import</span></div>
              <div className="stat"><b>{p.rejected.length}</b><span>rows it cannot read</span></div>
              <div className="stat"><b>{p.excluded.length}</b><span>rows left out</span></div>
              <div className="stat"><b>{p.empty.length}</b><span>empty rows skipped</span></div>
              <div className="stat"><b>{p.problems.filter((x) => x.severity === 'warning').length}</b><span>notes</span></div>
            </div>
          )}

          {!!p.rejected.length && (
            <form action={wizExcludeAction}>
              {hidden}
              <p>These rows cannot be read. Fix them with the columns or “read it as” above, or tick them to leave them out of this import.</p>
              <div className="tablewrap" style={{ maxHeight: '20rem' }}><table>
                <thead><tr><th></th><th className="n">Row</th><th>Why</th></tr></thead>
                <tbody>{p.rejected.map((r) => (
                  <tr key={r.row}><td><input type="checkbox" name="row" value={r.row} aria-label={`Leave out row ${r.row}`} /></td><td className="n">{r.row}</td><td className="small">{r.reasons.join('; ')}</td></tr>
                ))}</tbody>
              </table></div>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 3 }}><label htmlFor="reason">Why they are left out</label><input id="reason" name="reason" placeholder="e.g. common area meters, not billed" /></div>
                <div className="field"><button className="secondary" type="submit">Leave the ticked rows out</button></div>
              </div>
            </form>
          )}
          {!!p.excluded.length && (
            <form action={wizExcludeAction} className="flash">
              {hidden}<input type="hidden" name="intent" value="clear" />
              Left out: row{p.excluded.length > 1 ? 's' : ''} {p.excluded.join(', ')} — “{v.state.excludeReason}”. <button className="link" type="submit">Put them back</button>
            </form>
          )}
          {!!p.problems.filter((x) => x.severity === 'warning').length && (
            <details><summary className="small">Notes (rows are imported; the value shown is left blank or reported)</summary>
              <ul>{p.problems.filter((x) => x.severity === 'warning').slice(0, 100).map((x, i) => <li key={i} className="small">Row {x.row}: {fields.find((f) => f.key === x.field)?.label ?? x.field} {x.raw && <code>{x.raw}</code>} {x.message}</li>)}</ul>
            </details>
          )}

          {!!p.sample.length && (
            <>
              <h3>How the app will read it (first {p.sample.length} rows)</h3>
              <div className="tablewrap" style={{ maxHeight: '24rem' }}><table>
                <thead><tr><th className="n">Row</th>{p.columns.filter((c) => c.column || c.constant).map((c) => <th key={c.field}>{c.label}</th>)}</tr></thead>
                <tbody>{p.sample.map((r) => (
                  <tr key={r.row}><td className="n small">{r.row}</td>{p.columns.filter((c) => c.column || c.constant).map((c) => <td key={c.field} className="small nowrap">{r.values[c.field] === null || r.values[c.field] === undefined ? '' : String(r.values[c.field])}</td>)}</tr>
                ))}</tbody>
              </table></div>
            </>
          )}

          {ready && (
            <form action={wizImportAction} style={{ marginTop: '1rem' }}>
              {hidden}
              {v.changed ? (
                <div className="field"><label htmlFor="save_as">{!v.base ? 'Name this map (required)' : v.base.builtin ? 'Name for the new map (required; built-in maps are not changed)' : `Save as a new map named… (leave blank to save as version ${v.base.version + 1} of “${v.base.name}”)`}</label>
                  <input id="save_as" name="save_as" required={!v.base || v.base.builtin} placeholder="e.g. Acme radio export" /></div>
              ) : <p className="small">Uses “{v.base?.name}” as saved. Nothing new is saved.</p>}
              <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><input type="checkbox" name="create_missing" /> Add units and endpoints this property does not have yet</label>
              <div className="actions"><button type="submit">Import {p.rows.length} row{p.rows.length === 1 ? '' : 's'}</button></div>
            </form>
          )}
        </section>
      )}

      <form action={wizDiscardAction} style={{ marginTop: '1rem' }}>
        {hidden}<button className="link" type="submit">Discard this file</button> <span className="small">Files left here are removed after 7 days.</span>
      </form>
    </>
  );
}
