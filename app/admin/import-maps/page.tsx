import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { listLayouts } from '@/src/importer/wizard';
import { TARGETS } from '@/src/importer/targets';
import { retireLayoutAction } from '../../server-actions/wizard';
import { Badge, Flash, one, localDate, type SP } from '../../ui';

export default async function ImportMaps({ searchParams }: { searchParams: SP }) {
  await requireCan('import.maps');
  const sp = await searchParams;
  const maps = await listLayouts(await getDb(), { includeRetired: true });
  return (
    <>
      <h1>Import maps</h1>
      <p className="sub">How each kind of report is read: which column is which. New maps are made in the import wizard when a file is not recognised. <a href="/admin">Back to Admin</a></p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <div className="tablewrap"><table>
        <thead><tr><th>Map</th><th>Holds</th><th className="n">Version</th><th>Columns read</th><th className="n">Imports</th><th>Saved</th><th></th></tr></thead>
        <tbody>
          {maps.map((m) => (
            <tr key={m.id} className={m.retired ? 'muted' : ''}>
              <td><b>{m.name}</b> {m.builtin && <Badge>built in</Badge>} {m.retired && <Badge tone="bad">retired</Badge>}{m.source && <div className="small">{m.source}</div>}</td>
              <td>{TARGETS[m.target].label}</td><td className="n">{m.version}</td>
              <td className="small">{m.columns.map((c) => `${TARGETS[m.target].fields.find((f) => f.key === c.field)?.label ?? c.field}: ${c.headers.length ? c.headers.join(' / ') : `always “${c.default}”`}${c.lookup ? ` (${Object.keys(c.lookup).length} value rule${Object.keys(c.lookup).length > 1 ? 's' : ''})` : ''}`).join('; ')}</td>
              <td className="n">{m.uses}</td><td className="small">{localDate(m.createdAt)}</td>
              <td>{!m.builtin && !m.retired && (
                <form action={retireLayoutAction}><input type="hidden" name="id" value={m.id} /><button className="secondary" type="submit">Retire</button></form>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="small">A map is never edited in place: a change made in the wizard is saved as its next version, and every import records the map and version it used. Retiring a map stops new files matching it; past imports are unchanged.</p>
    </>
  );
}
