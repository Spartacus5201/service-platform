import { notFound } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { today } from '@/src/server/dates';
import { getProperty } from '@/src/server/queries';
import { lowBatteryReport, pmSettings } from '@/src/service/battery';
import { Badge } from '../../../ui';

export default async function Battery({ params }: { params: Promise<{ id: string }> }) {
  await requireCan('edit_documents');
  const { id } = await params;
  const db = await getDb();
  const p = await getProperty(db, id); if (!p) notFound();
  const rows = await lowBatteryReport(db, id, today());
  const pm = await pmSettings(db);
  return (
    <>
      <div className="crumbs"><a href="/">Properties</a> / <a href={`/properties/${id}`}>{p.name}</a> / Low battery</div>
      <h1>Low battery report</h1>
      <p className="sub">Transmitters whose latest check-in reports low battery. They are coded {pm.code} (preventative maintenance) on audits and added to new WAs and Proposals as their own line. Battery status comes from CIM check-in imports.</p>
      <p><a className="btn secondary" href={`/properties/${id}/battery/export`} download>Download Excel</a></p>
      <div className="tablewrap"><table>
        <thead><tr><th>Unit</th><th>Svc</th><th>Transmitter</th><th>Low since</th><th>Last check-in</th><th>Latest audit</th><th>Part warranty</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.deviceId}>
              <td className="nowrap">{r.endpointId ? <a href={`/endpoints/${r.endpointId}`}>{r.building}-{r.unit}</a> : '—'}</td><td>{r.service ?? ''}</td><td>{r.hardwareId}</td>
              <td>{r.firstLowOn}</td><td>{r.lastCheckIn}</td>
              <td>{r.auditCode ?? '—'}{r.failing && <> <Badge tone="bad">also failing</Badge></>}</td>
              <td>{r.partCovered ? <Badge tone="ok">covered</Badge> : <Badge>{r.partWarranty}</Badge>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="small">No transmitter reports low battery. (Only CIM imports with a battery column can show this.)</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
