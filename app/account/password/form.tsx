'use client';
import { useActionState } from 'react';
import { changePasswordAction } from '../../actions';

export default function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, { error: '' });
  return (
    <form action={action}>
      {state.error && <div className="flash error" role="alert">{state.error}</div>}
      <div className="field"><label htmlFor="current">Current password</label><input id="current" name="current" type="password" autoComplete="current-password" required /></div>
      <div className="field"><label htmlFor="next">New password</label><input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required /></div>
      <div className="field"><label htmlFor="again">New password again</label><input id="again" name="again" type="password" autoComplete="new-password" minLength={10} required /></div>
      <button type="submit" disabled={pending}>Save password</button>
    </form>
  );
}
