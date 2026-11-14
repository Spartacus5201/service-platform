import { getDb } from '@/src/server/db';
import { requireAny } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { ADMIN_AREA } from '@/src/auth/permissions';
import { listRoles } from '@/src/admin/roles';
import { SETTINGS, getSettings, listUsers, rawFileStats } from '@/src/admin/admin';
import { purgeNowAction, saveSettingsAction, userChangeAction } from '../server-actions/admin';
import { Badge, Flash, localTime, one, type SP } from '../ui';
import { AddUserForm, ResetButton } from './forms';

export default async function Admin({ searchParams }: { searchParams: SP }) {
  const me = await requireAny(ADMIN_AREA);
  const sp = await searchParams; const db = await getDb();
  const [users, settings, raw, roles] = await Promise.all([listUsers(db), getSettings(db), rawFileStats(db), listRoles(db)]);
  const roleName = (k: string) => roles.find((r) => r.key === k)?.name ?? k;
  const links = [
    can(me, 'roles.manage') && <a key="r" href="/admin/roles">Roles</a>, can(me, 'activity.view') && <a key="a" href="/admin/activity">Activity log</a>,
    can(me, 'import.maps') && <a key="m" href="/admin/import-maps">Import maps</a>, can(me, 'lists.edit') && <a key="s" href="/admin/services">Service codes</a>,
  ].filter(Boolean);
  return (
    <>
      <h1>Admin</h1>
      <p className="sub">Who can sign in and what they can do, the numbers the rules use, and backups. You see the parts your roles allow.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />

      {links.length > 0 && <p className="small">{links.map((l, i) => <span key={i}>{i > 0 && ' · '}{l}</span>)}</p>}

      {can(me, 'settings.system') && (<>
      <h2>Backup</h2>
      <p className="small"><a href="/admin/backup" download>Download a full backup</a>. To restore, stop the app and run <code>npx tsx scripts/restore.ts &lt;file&gt;</code>; the current data is kept alongside.</p>
      </>)}

      {can(me, 'users.manage') && (<>
      <h2>Users</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'muted'}>
              <td>{u.name}{u.id === me.userId && <span className="small"> (you)</span>}</td><td>{u.email}</td>
              <td>
                <details>
                  <summary className="small">{u.roles.map(roleName).join(', ') || 'no role'}</summary>
                  <form action={userChangeAction} style={{ display: 'grid', gap: '.2rem', marginTop: '.3rem' }}>
                    <input type="hidden" name="user_id" value={u.id} />
                    {roles.map((r) => <label key={r.key} className="small"><input type="checkbox" name="roles" value={r.key} defaultChecked={u.roles.includes(r.key)} /> {r.name}</label>)}
                    <button className="secondary" type="submit">Save roles</button>
                  </form>
                </details>
              </td>
              <td className="small nowrap">{u.last_login ? localTime(u.last_login) : 'never'}</td>
              <td>{!u.active ? <Badge tone="bad">inactive</Badge> : u.must_change_password ? <Badge tone="warn">must set password</Badge> : <Badge tone="ok">active</Badge>}</td>
              <td>
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  {u.active && <ResetButton userId={u.id} who={u.email} />}
                  <form action={userChangeAction}><input type="hidden" name="user_id" value={u.id} />
                    <button className="secondary" type="submit" name="intent" value={u.active ? 'deactivate' : 'reactivate'}>{u.active ? 'Deactivate' : 'Reactivate'}</button></form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <AddUserForm roles={roles.map((r) => ({ key: r.key, name: r.name, description: r.description ?? '' }))} />
      </>)}

      {can(me, 'rules.edit') && (<>
      <h2>Settings</h2>
      <form action={saveSettingsAction} className="card">
        {SETTINGS.map((s) => (
          <div className="row" key={s.key} style={{ alignItems: 'center' }}>
            <div className="field"><label htmlFor={s.key}>{s.label}</label><input id={s.key} name={s.key} className="num" inputMode={s.decimal ? 'decimal' : 'numeric'} defaultValue={settings[s.key] ?? ''} /></div>
            <div className="field" style={{ flex: 3 }}><span className="small">{s.unit} · {s.help}</span></div>
          </div>
        ))}
        <p className="small">Changes apply to the next audit view or document; issued documents and recorded service keep the values they were made with.</p>
        <div className="actions"><button type="submit">Save settings</button></div>
      </form>
      </>)}

      {can(me, 'settings.system') && (<>
      <h2>Raw import files</h2>
      <div className="card">
        <p style={{ marginTop: 0 }}>{raw.kept} raw file(s) kept ({(raw.bytes / 1048576).toFixed(1)} MB). {raw.due} past their retention date.
          Expired files are deleted automatically whenever someone imports a report; parsed readings and history are never deleted.</p>
        <form action={purgeNowAction}><button className="secondary" type="submit" disabled={!raw.due}>Delete expired files now</button></form>
      </div>
      </>)}
    </>
  );
}
