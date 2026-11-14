import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { listRoles } from '@/src/admin/roles';
import { PERMISSIONS, DEFAULT_GRID } from '@/src/auth/permissions';
import { saveRoleAction, addRoleAction } from '../../server-actions/admin';
import { Badge, Flash, one, type SP } from '../../ui';

const AREAS = [...new Set(PERMISSIONS.map((p) => p.area))];

export default async function Roles({ searchParams }: { searchParams: SP }) {
  await requireCan('roles.manage');
  const sp = await searchParams; const db = await getDb();
  const roles = await listRoles(db, { includeRetired: true });
  const sel = roles.find((r) => r.key === one(sp.role)) ?? roles[0];
  const defaults = DEFAULT_GRID[sel.key];
  return (
    <>
      <h1>Roles</h1>
      <p className="sub">What each role can do. A person can hold several roles and gets everything they allow. <a href="/admin">Back to Admin</a></p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />

      <div className="tablewrap" style={{ maxHeight: 'none' }}><table>
        <thead><tr><th>Permission</th>{roles.map((r) => <th key={r.key} className="n"><a href={`/admin/roles?role=${r.key}`}>{r.name}</a>{r.retired && <div><Badge>retired</Badge></div>}<div className="small">{r.users} {r.users === 1 ? 'person' : 'people'}</div></th>)}</tr></thead>
        <tbody>
          {AREAS.map((area) => [
            <tr key={area}><td colSpan={roles.length + 1}><b>{area}</b></td></tr>,
            ...PERMISSIONS.filter((p) => p.area === area).map((p) => (
              <tr key={p.key}><td className="small">{p.label}</td>
                {roles.map((r) => <td key={r.key} className="n">{r.perms[p.key] === 'all' ? '✓' : r.perms[p.key] === 'own' ? 'own' : ''}</td>)}</tr>
            )),
          ])}
        </tbody>
      </table></div>

      <form action={saveRoleAction} className="card" style={{ marginTop: '1rem' }}>
        <input type="hidden" name="role_key" value={sel.key} />
        <h2 style={{ marginTop: 0 }}>Change {sel.name} {sel.builtin && <Badge>built in</Badge>} {sel.retired && <Badge tone="bad">retired</Badge>}</h2>
        <div className="row">
          <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" defaultValue={sel.name} required /></div>
          <div className="field" style={{ flex: 3 }}><label htmlFor="description">What it is for</label><input id="description" name="description" defaultValue={sel.description ?? ''} /></div>
        </div>
        {AREAS.map((area) => (
          <fieldset key={area} style={{ border: 0, padding: 0, margin: '.6rem 0' }}><legend><b>{area}</b></legend>
            {PERMISSIONS.filter((p) => p.area === area).map((p) => {
              const locked = sel.key === 'admin' && 'locked' in p && p.locked;
              const cur = sel.perms[p.key] ?? '';
              const def = defaults ? (defaults[p.key] ?? '') : null;
              return (
                <div key={p.key} className="row" style={{ alignItems: 'center', margin: '.15rem 0' }}>
                  <div className="field" style={{ flex: '0 0 9rem' }}>
                    <select name={`p:${p.key}`} defaultValue={cur} disabled={locked} aria-label={p.label}>
                      <option value="">No</option><option value="all">Yes</option>{'own' in p && p.own && <option value="own">Own records only</option>}
                    </select>
                    {locked && <input type="hidden" name={`p:${p.key}`} value="all" />}
                  </div>
                  <div className="field" style={{ flex: 4 }}><span>{p.label}</span>
                    {'help' in p && p.help && <span className="small"> {p.help}</span>}
                    {locked && <span className="small"> Always on for Admin.</span>}
                    {def !== null && def !== cur && <span className="small"> (default: {def === 'all' ? 'yes' : def === 'own' ? 'own records' : 'no'})</span>}
                  </div>
                </div>
              );
            })}
          </fieldset>
        ))}
        <div className="actions">
          <button type="submit">Save {sel.name}</button>
          {defaults && <button className="secondary" type="submit" name="intent" value="restore">Restore defaults</button>}
          {sel.key !== 'admin' && <button className="secondary" type="submit" name="intent" value={sel.retired ? 'unretire' : 'retire'}>{sel.retired ? 'Bring back' : 'Retire role'}</button>}
        </div>
        <p className="small">Changes take effect on each person&rsquo;s next page. Nobody can save a change that leaves no one able to manage users and roles.</p>
      </form>

      <form action={addRoleAction} className="card">
        <h2 style={{ marginTop: 0 }}>Add a role</h2>
        <div className="row">
          <div className="field"><label htmlFor="new_name">Name</label><input id="new_name" name="name" required placeholder="e.g. Field Lead" /></div>
          <div className="field" style={{ flex: 2 }}><label htmlFor="new_desc">What it is for</label><input id="new_desc" name="description" /></div>
          <div className="field"><label htmlFor="copy_from">Start from</label>
            <select id="copy_from" name="copy_from" defaultValue=""><option value="">Nothing</option>{roles.filter((r) => !r.retired).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></div>
        </div>
        <div className="actions"><button type="submit">Add role</button></div>
      </form>
    </>
  );
}
