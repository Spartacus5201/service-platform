'use client';
import { useActionState } from 'react';
import { addUserAction, resetPasswordAction } from '../actions';
import type { SecretState } from '../types';

function Secret({ s }: { s: SecretState }) {
  if (s.error) return <div className="flash error" role="alert">{s.error}</div>;
  if (!s.password) return null;
  return (
    <div className="flash ok" role="status">
      Temporary password for <b>{s.who}</b>: <code style={{ fontSize: '1.05em', userSelect: 'all' }}>{s.password}</code>
      <div className="small">Shown once. Give it to them directly; they must choose their own at first sign-in.</div>
    </div>
  );
}

export function AddUserForm({ roles }: { roles: { role: string; label: string; help: string }[] }) {
  const [st, action, pending] = useActionState<SecretState, FormData>(addUserAction, {});
  return (
    <form action={action} className="card">
      <h2 style={{ marginTop: 0 }}>Add a user</h2>
      <div className="row">
        <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" required /></div>
        <div className="field" style={{ flex: 2 }}><label htmlFor="email">Email (sign-in name)</label><input id="email" name="email" type="email" required /></div>
        <div className="field"><label htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue="office">{roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</select></div>
      </div>
      <p className="small">{roles.map((r) => `${r.label}: ${r.help}`).join(' ')}</p>
      <Secret s={st} />
      <div className="actions"><button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add user'}</button></div>
    </form>
  );
}

export function ResetButton({ userId, who }: { userId: string; who: string }) {
  const [st, action, pending] = useActionState<SecretState, FormData>(resetPasswordAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="user_id" value={userId} /><input type="hidden" name="who" value={who} />
      <button className="secondary" type="submit" disabled={pending}>Reset password</button>
      <Secret s={st} />
    </form>
  );
}
