import { redirect } from 'next/navigation';
import { getSession } from '@/src/server/session';
import LoginForm from './form';

export default async function LoginPage() {
  if (await getSession()) redirect('/');
  return (
    <div className="login card">
      <h1>Service Platform</h1>
      <p className="sub">Sign in to continue.</p>
      <LoginForm />
    </div>
  );
}
