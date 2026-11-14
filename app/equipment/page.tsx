import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { listModels, inField, currentPart } from '@/src/equipment/registry';
import { StatusBadge } from './status';
import { today } from '@/src/server/dates';
import { Flash, one, type SP } from '../ui';

const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : `$${n.toFixed(2)}`);
export default async function Equipment({ searchParams }: { searchParams: SP }) {
  const s = await requireCan('price.view');
  const sp = await searchParams; const db = await getDb(); const on = today();
  const edit = can(s, 'equipment.edit');
  const [models, field] = await Promise.all([listModels(db), inField(db)]);
  const parts = new Map(await Promise.all(models.flatMap((m) => [m.partItemId, m.batteryItemId]).filter((x): x is string => !!x)
    .map(async (id) => [id, await currentPart(db, id, on)] as const)));
  const counts = new Map<string, { devices: number; properties: number }>();
  for (const f of field) if (f.model) { const c = counts.get(f.model.id) ?? { devices: 0, properties: 0 }; c.devices += f.devices; c.properties = Math.max(c.properties, f.properties); counts.set(f.model.id, c); }
  const unknown = field.filter((f) => !f.model);
  const kind = one(sp.kind) ?? ''; const status = one(sp.status) ?? '';
  const shown = models.filter((m) => (!kind || m.kind === kind) && (!status || m.status === status));
  return (
    <>
      <h1>Equipment</h1>
      <p className="sub">Every equipment model: who makes it, whether it is still current, what replaces it, the part quoted to replace it and the battery it takes. Prices come from the catalog.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />

      {unknown.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>In the field but not in the registry</h2>
          <p className="small" style={{ marginTop: 0 }}>Model codes the reports gave these devices. Until a model is added, its battery uses the default price and a replacement uses the catalog's suggested part.</p>
          <table>
            <thead><tr><th>Code in reports</th><th>Kind</th><th className="n">Devices</th><th className="n">Properties</th><th></th></tr></thead>
            <tbody>{unknown.map((u) => (
              <tr key={u.code + u.kind}><td><b>{u.code}</b></td><td>{u.kind}</td><td className="n">{u.devices}</td><td className="n">{u.properties}</td>
                <td>{edit && <a className="btn secondary" href={`/equipment/new?model=${encodeURIComponent(u.code)}&kind=${u.kind}`}>Add</a>}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}

      <form method="get" className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="kind">Kind</label><select id="kind" name="kind" defaultValue={kind}><option value="">All</option>{[...new Set(models.map((m) => m.kind))].map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
        <div className="field"><label htmlFor="status">Status</label><select id="status" name="status" defaultValue={status}><option value="">All</option><option value="current">Current</option><option value="phasing_out">Phasing out</option><option value="obsolete">Obsolete</option></select></div>
        <div className="field"><button className="secondary" type="submit">Show</button></div>
        {edit && <div className="field" style={{ marginLeft: 'auto' }}><a className="btn" href="/equipment/new">Add a model</a></div>}
      </form>
      <div className="tablewrap"><table>
        <thead><tr><th>Model</th><th>Kind</th><th>System</th><th>Status</th><th>Replacement part</th><th>Battery</th><th className="n">In the field</th></tr></thead>
        <tbody>
          {shown.map((m) => { const part = m.partItemId ? parts.get(m.partItemId) : null; const bat = m.batteryItemId ? parts.get(m.batteryItemId) : null; const c = counts.get(m.id);
            return (
              <tr key={m.id}>
                <td><a href={`/equipment/${m.id}`}><b>{m.manufacturer} {m.model}</b></a>{m.aliases.length > 0 && <div className="small">also: {m.aliases.join(', ')}</div>}</td>
                <td>{m.kind}</td><td className="small">{m.readingSystem ?? ''}{m.services.length ? ` · ${m.services.join(', ')}` : ''}</td>
                <td><StatusBadge m={m} /></td>
                <td className="small">{part ? `${part.name} ${money(part.price)}` : '—'}</td>
                <td className="small">{bat ? `${bat.name} ${money(bat.price)}` : m.kind === 'transmitter' || m.kind === 'combo' ? 'default price' : '—'}</td>
                <td className="n">{c ? `${c.devices} at ${c.properties} propert${c.properties === 1 ? 'y' : 'ies'}` : '0'}</td>
              </tr>
            ); })}
          {!shown.length && <tr><td colSpan={7} className="small">{models.length ? 'Nothing matches.' : 'No models yet. Add the ones in the field from the list above.'}</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
