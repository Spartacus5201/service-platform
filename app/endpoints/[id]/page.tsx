import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireSession } from '@/src/server/session';
import { today } from '@/src/server/dates';
import { can } from '@/src/auth/auth';
import { endpointHistory } from '@/src/service/history';
import { catalogItems } from '@/src/server/queries';
import { Badge, Flash, warrantyTone, one, us, type SP } from '../../ui';
import VisitForm from './visit-form';

export default async function EndpointPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const s = await requireSession();
  const { id } = await params; const sp = await searchParams;
  if (!can(s.role, 'view_history')) notFound();
  const db = await getDb();
  let h; try { h = await endpointHistory(db, id, today()); } catch { notFound(); }
  const e = h.endpoint;
  const prop = (await db.query<{ name: string }>(`SELECT name FROM property WHERE id=$1`, [e.propertyId])).rows[0];
  const unit = (await db.query<{ address: string | null; move_in_on: string | null; known: boolean }>(
    `SELECT u.service_address address, u.move_in_on::text, u.occupancy_as_of IS NOT NULL known FROM endpoint ep JOIN unit u ON u.id=ep.unit_id WHERE ep.id=$1`, [id])).rows[0];
  const catalog = can(s.role, 'record_service') ? (await catalogItems(db)).filter((c) => c.kind === 'part').map((c) => ({ id: c.id, name: c.name })) : [];
  const layer = (name: string, l: { status: string; startedOn?: string; endsOn?: string }) => (
    <div className="stat"><b><Badge tone={warrantyTone(l.status)}>{l.status}</Badge></b><span>{name}{l.endsOn ? ` · to ${us(l.endsOn)}` : ''}</span></div>
  );
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${e.propertyId}`}>{prop?.name}</a> / {e.building}-{e.unit}</div>
      <h1>{e.building}-{e.unit} · {e.service}{e.isManual ? ' (manual read)' : ''}</h1>
      <p className="sub">{unit?.address ?? 'No address on file'} · {!unit?.known ? 'occupancy unknown' : unit.move_in_on ? `occupied since ${us(unit.move_in_on)}` : 'vacant'}</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <h2>Warranty today</h2>
      <div className="stats">{layer('Install', h.coverage.install)}{layer('Service labor', h.coverage.labor)}{layer('Service part', h.coverage.part)}</div>
      {!!h.coverage.basis.length && <p className="small">{h.coverage.basis.join(' · ')}</p>}

      <h2>Devices</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Kind</th><th>ID</th><th>Serial</th><th>Model</th><th>Installed</th><th>Source</th><th>Status</th></tr></thead>
        <tbody>
          {h.devices.map((d) => (
            <tr key={d.id} className={d.removedOn ? 'muted' : ''}>
              <td>{d.kind}{d.placeholder ? ' (placeholder)' : ''}</td><td>{d.hardwareId ? <a href={`/search?q=${encodeURIComponent(d.hardwareId)}`}>{d.hardwareId}</a> : '—'}</td><td>{d.serial ?? '—'}</td><td>{d.model ?? '—'}</td>
              <td>{us(d.installedOn) || '—'}</td><td>{d.origin.replace(/_/g, ' ')}</td><td>{d.removedOn ? `removed ${us(d.removedOn)}` : 'installed'}</td>
            </tr>
          ))}
          {!h.devices.length && <tr><td colSpan={7} className="small">No devices on record.</td></tr>}
        </tbody>
      </table></div>


      <h2>History</h2>
      <ul className="timeline card">
        {h.timeline.map((t, i) => (
          <li key={i}><span className="d">{us(t.date)}</span><span><Badge tone={t.type === 'service' ? 'info' : t.type === 'install' ? 'ok' : t.type === 'document' ? 'warn' : 'gray'}>{t.type === 'reading' ? 'audit' : t.type}</Badge></span><span>{t.href ? <a href={t.href}>{t.summary}</a> : t.summary}
            {t.job ? <> · <a href={`/jobs/${t.job.id}`}>Job #{t.job.number}</a></> : null}
            {t.type === 'service' && typeof t.detail.notes === 'string' && t.detail.notes ? <span className="small"> — {t.detail.notes}</span> : null}
            {t.type === 'service' && (t.detail.salesforce_case || t.detail.salesforce_work_order) ? <span className="small"> · {[t.detail.salesforce_case && `Case ${t.detail.salesforce_case}`, t.detail.salesforce_work_order && `WO ${t.detail.salesforce_work_order}`].filter(Boolean).join(' · ')}</span> : null}
          </span></li>
        ))}
        {!h.timeline.length && <li className="small">Nothing recorded yet.</li>}
      </ul>
      {can(s.role, 'record_service') && <div style={{ marginTop: '1rem' }}><VisitForm endpointId={id} propertyId={e.propertyId} today={today()} isManual={e.isManual} catalog={catalog} /></div>}
    </>
  );
}
