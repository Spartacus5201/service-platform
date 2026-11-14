'use client';
import { useActionState } from 'react';
import { login } from '../server-actions/account';

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, { error: '' });
  return (
    <form action={action}>
      {state.error && <div className="flash error" role="alert">{state.error}</div>}
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required autoFocus /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
