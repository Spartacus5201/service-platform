import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { loadLists } from '@/src/lists/lists';
import { requireCan } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { getModel, listModels, inField, catalogOptions, suggestParts, KINDS, STATUSES, STATUS_LABEL, type CatalogOption } from '@/src/equipment/registry';
import { listServices } from '@/src/lists/services';
import { saveModelAction } from '../../server-actions/equipment';
import { StatusBadge } from '../status';
import { Flash, localTime, one, type SP } from '../../ui';

const money = (n: number | null) => (n === null ? 'no price' : `$${n.toFixed(2)}`);
const label = (o: CatalogOption) => `${o.name}${o.partNumber ? ` (${o.partNumber})` : ''} — ${money(o.price)}${o.obsolete ? ' — obsolete in price list' : ''}`;
const COMPONENT: Record<string, string[]> = { transmitter: ['transmitter'], combo: ['combo', 'transmitter'], meter: ['meter'], repeater: ['repeater'], collector: ['collector'], receiver: ['collector'] };

function PartSelect({ name, options, suggested, value, none }: { name: string; options: CatalogOption[]; suggested: CatalogOption[]; value: string | null; none: string }) {
  const rest = options.filter((o) => !suggested.includes(o));
  return (
    <select id={name} name={name} defaultValue={value ?? ''}>
      <option value="">{none}</option>
      {suggested.length > 0 && <optgroup label="Name this model">{suggested.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}</optgroup>}
      <optgroup label={suggested.length ? 'Everything else' : 'Catalog'}>{rest.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}</optgroup>
    </select>
  );
}

export default async function ModelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const s = await requireCan('price.view'); const edit = can(s, 'equipment.edit');
  const { id } = await params; const sp = await searchParams; const db = await getDb();
  const isNew = id === 'new';
  if (isNew && !edit) notFound();
  const m = isNew ? null : await getModel(db, id);
  if (!isNew && !m) notFound();
  const draft = { manufacturer: one(sp.manufacturer) ?? '', model: one(sp.model) ?? '', kind: one(sp.kind) && (KINDS as readonly string[]).includes(one(sp.kind)!) ? one(sp.kind)! : 'transmitter' };
  const kind = m?.kind ?? draft.kind;
  const lists = await loadLists(db);
  const codes = m ? [m.model, ...m.aliases] : [draft.model];
  const [models, services, partOpts, batOpts] = await Promise.all([listModels(db), listServices(db, { includeRetired: true }), catalogOptions(db, COMPONENT[kind] ?? [kind]), catalogOptions(db, ['battery'])]);
  const field = m ? (await inField(db)).filter((f) => f.model?.id === m.id) : [];
  const where = m ? (await db.query<{ id: string; name: string; n: string }>(
    `SELECT p.id, p.name, count(*) n FROM device d JOIN property p ON p.id=d.property_id WHERE d.status='active' AND upper(regexp_replace(coalesce(d.model,''),'[^A-Za-z0-9]+','','g')) = ANY($1) GROUP BY p.id, p.name ORDER BY count(*) DESC LIMIT 30`,
    [codes.map((c) => c.toUpperCase().replace(/[^A-Z0-9]+/g, ''))])).rows : [];
  const history = m ? (await db.query<{ at: string; who: string | null; action: string; detail: Record<string, unknown> }>(
    `SELECT l.at::text, u.name who, l.action, l.detail FROM audit_log l LEFT JOIN app_user u ON u.id=l.user_id WHERE l.entity='equipment_model' AND l.entity_id=$1 ORDER BY l.id DESC LIMIT 20`, [m.id])).rows : [];
  const manufacturers = [...new Set(models.map((x) => x.manufacturer))].sort();
  const systems = [...new Set(models.map((x) => x.readingSystem).filter(Boolean) as string[])].sort();
  const others = models.filter((x) => x.id !== m?.id);
  const showBattery = ['transmitter', 'combo', 'repeater'].includes(kind);
  return (
    <>
      <div className="crumbs"><a href="/equipment">Equipment</a> / {m ? `${m.manufacturer} ${m.model}` : 'New model'}</div>
      <h1>{m ? <>{m.manufacturer} {m.model} <StatusBadge m={m} /></> : 'Add an equipment model'}</h1>
      {m && <p className="sub">{field.reduce((n, f) => n + f.devices, 0)} in the field{where.length ? `: ${where.map((w) => `${w.name} (${w.n})`).join(', ')}` : ''}.</p>}
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      {edit ? (
        <form action={saveModelAction} className="card">
          {m && <input type="hidden" name="id" value={m.id} />}
          <div className="row">
            <div className="field"><label htmlFor="manufacturer">Manufacturer</label><input id="manufacturer" name="manufacturer" list="mfrs" required defaultValue={m?.manufacturer ?? draft.manufacturer} /><datalist id="mfrs">{manufacturers.map((x) => <option key={x} value={x} />)}</datalist></div>
            <div className="field"><label htmlFor="model">Model code (as reports show it)</label><input id="model" name="model" required defaultValue={m?.model ?? draft.model} /></div>
            <div className="field"><label htmlFor="kind">Kind</label><select id="kind" name="kind" defaultValue={kind}>{KINDS.map((k) => <option key={k} value={k}>{lists.label('device_kind', k)}</option>)}</select></div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}><label htmlFor="aliases">Other names reports use (comma separated)</label><input id="aliases" name="aliases" defaultValue={m?.aliases.join(', ') ?? ''} placeholder="e.g. NC-TR4, TR-4" /></div>
            <div className="field"><label htmlFor="reading_system">Reading system</label><input id="reading_system" name="reading_system" list="systems" defaultValue={m?.readingSystem ?? ''} placeholder="e.g. Next Century" /><datalist id="systems">{systems.map((x) => <option key={x} value={x} />)}</datalist></div>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: '.5rem 0' }}><legend className="small">Services it is used for</legend>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>{services.map((x) => <label key={x.code}><input type="checkbox" name="services" value={x.code} defaultChecked={m?.services.includes(x.code)} /> {x.code} {x.name}</label>)}</div>
          </fieldset>
          <div className="row">
            <div className="field"><label htmlFor="status">Status</label><select id="status" name="status" defaultValue={m?.status ?? 'current'}>{STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</select></div>
            <div className="field" style={{ flex: 2 }}><label htmlFor="replaced_by">Replaced by</label>
              <select id="replaced_by" name="replaced_by" defaultValue={m?.replacedBy ?? ''}><option value="">— nothing —</option>{others.map((x) => <option key={x.id} value={x.id}>{x.manufacturer} {x.model} ({x.kind}{x.status !== 'current' ? `, ${STATUS_LABEL[x.status].toLowerCase()}` : ''})</option>)}</select></div>
          </div>
          <p className="small">When a phasing-out or obsolete model fails, new WAs and Proposals quote the replacement model's part, and the line says so.</p>
          <div className="field"><label htmlFor="part_item_id">Part quoted to replace one</label>
            <PartSelect name="part_item_id" options={partOpts} suggested={suggestParts(partOpts, codes)} value={m?.partItemId ?? null} none="— the catalog's suggested part —" /></div>
          {showBattery && <div className="row">
            <div className="field" style={{ flex: 3 }}><label htmlFor="battery_item_id">Battery it takes</label>
              <PartSelect name="battery_item_id" options={batOpts} suggested={suggestParts(batOpts, codes)} value={m?.batteryItemId ?? null} none="— default battery price —" /></div>
            <div className="field"><label htmlFor="battery_life_years">Battery life (years)</label><input id="battery_life_years" name="battery_life_years" className="num" inputMode="decimal" defaultValue={m?.batteryLifeYears ?? ''} /></div>
          </div>}
          <div className="field"><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} defaultValue={m?.notes ?? ''} /></div>
          <div className="actions"><button type="submit">{m ? 'Save' : 'Add to registry'}</button> <a className="btn secondary" href="/equipment">Cancel</a></div>
        </form>
      ) : m && (
        <div className="card small">{lists.label('device_kind', m.kind)} · {m.readingSystem ?? 'no system set'} · {m.services.join(', ') || 'no services set'}{m.aliases.length ? ` · also: ${m.aliases.join(', ')}` : ''}{m.notes ? ` · ${m.notes}` : ''}</div>
      )}
      {history.length > 0 && (<>
        <h2>Changes</h2>
        <ul>{history.map((h, i) => <li key={i} className="small">{localTime(h.at)} · {h.who ?? 'system'} · {h.action === 'equipment_added' ? 'added' : `changed ${Object.keys(h.detail).filter((k) => k !== 'model').join(', ')}`}</li>)}</ul>
      </>)}
    </>
  );
}
