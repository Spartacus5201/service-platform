import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { today } from '@/src/server/dates';
import { getProperty } from '@/src/server/queries';
import { lowBatteryReport, pmSettings } from '@/src/service/battery';
import { Badge, money } from '../../../ui';

export default async function Battery({ params }: { params: Promise<{ id: string }> }) {
  await requireCan('edit_documents');
  const { id } = await params;
  const db = await getDb();
  const p = await getProperty(db, id); if (!p) notFound();
  const rows = await lowBatteryReport(db, id, today());
  const pm = await pmSettings(db);
  const stopped = rows.filter((r) => r.stopped).length;
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${id}`}>{p.name}</a> / Low battery</div>
      <h1>Low battery report</h1>
      <p className="sub">Transmitters whose latest check-in reports low battery (at or below {pm.threshold}%). Still reading: coded {pm.code} (preventative maintenance) and added to new WAs and Proposals as a battery replacement. Stopped checking in: the audit's failure line is priced as a battery. Battery status comes from the AMR Status Report and CIM imports.</p>
      <p className="small">{rows.length} low: {rows.length - stopped} still checking in (preventative maintenance), {stopped} stopped checking in.</p>
      <p><a className="btn secondary" href={`/properties/${id}/battery/export`} download>Download Excel</a></p>
      <div className="tablewrap"><table>
        <thead><tr><th>Unit</th><th>Svc</th><th>Transmitter</th><th>Model</th><th>Battery</th><th>Low since</th><th>Last check-in</th><th>Latest audit</th><th>Battery price</th><th>Warranty</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.deviceId}>
              <td className="nowrap">{r.endpointId ? <a href={`/endpoints/${r.endpointId}`}>{r.building}-{r.unit}</a> : '—'}</td><td>{r.service ?? ''}</td><td>{r.hardwareId}</td><td>{r.model ?? ''}</td><td>{r.batteryLevel === null ? 'low' : `${r.batteryLevel}%`}</td>
              <td>{r.firstLowOn}</td><td>{r.lastCheckIn}{r.stopped && <> <Badge tone="bad">stopped</Badge></>}</td>
              <td>{r.auditCode ?? '—'}{r.failing && <> <Badge tone="bad">also failing</Badge></>}</td>
              <td className="n">{money(r.batteryPrice)}</td>
              <td>{r.partCovered ? <Badge tone="ok">covered</Badge> : <Badge>{r.partWarranty}</Badge>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={10} className="small">No transmitter reports low battery. (Only CIM imports with a battery column can show this.)</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
