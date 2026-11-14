import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { listActivity, listUsers } from '@/src/admin/admin';
import { localTime, one, type SP } from '../../ui';

export default async function Activity({ searchParams }: { searchParams: SP }) {
  await requireCan('activity.view');
  const sp = await searchParams; const db = await getDb();
  const action = one(sp.action) || undefined; const userId = one(sp.user) || undefined; const before = one(sp.before) || undefined;
  const [{ rows, actions, more }, users] = await Promise.all([listActivity(db, { action, userId, before }), listUsers(db)]);
  const next = new URLSearchParams({ ...(action ? { action } : {}), ...(userId ? { user: userId } : {}), before: rows.at(-1)?.id ?? '' });
  return (
    <>
      <h1>Activity log</h1>
      <p className="sub">Sign-ins, setting changes, corrections and approvals. Newest first. <a href="/admin">Back to Admin</a></p>
      <form method="get" className="card">
        <div className="row">
          <div className="field"><label htmlFor="action">What</label>
            <select id="action" name="action" defaultValue={action ?? ''}><option value="">Everything</option>{actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}</select></div>
          <div className="field"><label htmlFor="user">Who</label>
            <select id="user" name="user" defaultValue={userId ?? ''}><option value="">Anyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          <div className="field"><button type="submit">Show</button></div>
        </div>
      </form>
      <div className="tablewrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>About</th><th>Detail</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}><td className="small nowrap">{localTime(r.at)}</td><td>{r.who ?? <span className="small">—</span>}</td><td>{r.label}</td>
              <td className="small">{r.entity ?? ''}</td><td className="small">{r.detail}</td></tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="small">Nothing logged yet.</td></tr>}
        </tbody>
      </table></div>
      {more && <p><a href={`/admin/activity?${next}`}>Older entries</a></p>}
    </>
  );
}
