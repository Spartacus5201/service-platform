import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { heldImport, listSnapshots, previewSetup, SECTIONS } from '@/src/admin/setup';
import { cancelSetupImportAction, importSetupAction, previewSetupAction, previewSnapshotAction } from '../../server-actions/setup';
import { Badge, Flash, localTime, one, type SP } from '../../ui';

const few = (xs: string[], n = 12) => (xs.length > n ? `${xs.slice(0, n).join(', ')} and ${xs.length - n} more` : xs.join(', '));

export default async function SetupPage({ searchParams }: { searchParams: SP }) {
  const me = await requireCan('settings.system');
  const sp = await searchParams; const db = await getDb();
  const held = await heldImport(db, me.userId);
  const preview = held ? await previewSetup(db, held.file) : null;
  const snaps = await listSnapshots(db);
  return (
    <>
      <h1>Setup</h1>
      <p className="sub">Everything people configure, as one file: to move it to another server, keep a copy, or put it back. <a href="/admin">Back to Admin</a></p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <p className="small">
        In the file: {SECTIONS.map((s) => s.label.toLowerCase()).join(', ')}. Not in it: properties, audits, visits, documents, users or passwords (use a full backup for those).
      </p>

      <h2>Export</h2>
      <p><a className="btn" href="/admin/setup/export" download>Download the setup file</a></p>

      <h2>Import</h2>
      <form action={previewSetupAction} className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="file">Setup file (.json)</label><input id="file" name="file" type="file" accept=".json,application/json" required /></div>
        <div className="field"><button className="secondary" type="submit">Preview</button></div>
      </form>
      <p className="small">Nothing changes until you press Import on the preview. The setup as it was is kept first, so an import can be undone below.
        Items on this server that are not in the file are kept (retire them if they are not wanted), except audit rules and each role's permissions, which are made to match the file.</p>

      {held && preview && (
        <section id="preview" className="card" style={{ marginTop: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Preview: {held.source}</h2>
          <p className="small">Exported {localTime(preview.exportedAt)}.</p>
          {preview.warnings.map((w) => <p key={w} className="flash error">{w}</p>)}
          <div className="tablewrap"><table>
            <thead><tr><th>Section</th><th>Added</th><th>Changed</th><th className="n">Same</th><th>Only on this server</th></tr></thead>
            <tbody>{preview.sections.map((s) => (
              <tr key={s.key} data-section={s.key}>
                <td>{s.label}</td>
                <td className="small">{s.added.length ? <><Badge tone="ok">{s.added.length}</Badge> {few(s.added)}</> : '—'}</td>
                <td className="small">{s.changed.length ? <><Badge tone="warn">{s.changed.length}</Badge> {few(s.changed)}</> : '—'}</td>
                <td className="n">{s.unchanged}</td>
                <td className="small">{s.onlyHere.length ? <>{s.mode === 'match' ? <Badge tone="warn">removed: {s.onlyHere.length}</Badge> : <Badge>kept: {s.onlyHere.length}</Badge>} {few(s.onlyHere)}</> : '—'}</td>
              </tr>))}</tbody>
          </table></div>
          <div className="actions">
            {preview.total > 0 && <form action={importSetupAction} style={{ display: 'inline' }}><button type="submit">Import {preview.total} change{preview.total === 1 ? '' : 's'}</button></form>}
            {preview.total === 0 && <p className="small">Nothing in the file differs from this server.</p>}
            {' '}<form action={cancelSetupImportAction} style={{ display: 'inline' }}><button className="secondary" type="submit">Cancel</button></form>
          </div>
        </section>
      )}

      <h2>Earlier setups</h2>
      {!snaps.length ? <p className="small">None yet. One is kept before every import.</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Kept</th><th>Why</th><th>By</th><th></th></tr></thead>
          <tbody>{snaps.map((x) => (
            <tr key={x.id}><td>{localTime(x.taken_at)}</td><td>{x.reason}</td><td>{x.by ?? ''}</td>
              <td><form action={previewSnapshotAction}><input type="hidden" name="snapshot_id" value={x.id} /><button className="secondary" type="submit">Put back (preview)</button></form></td></tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
