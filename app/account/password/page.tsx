import { requireSession } from '@/src/server/session';
import PasswordForm from './form';

export default async function PasswordPage() {
  const s = await requireSession({ allowPasswordChange: true });
  return (
    <div className="login card">
      <h1>Change password</h1>
      <p className="sub">{s.mustChangePassword ? 'Choose a new password before continuing.' : 'Use at least 10 characters.'}</p>
      <PasswordForm />
    </div>
  );
}
