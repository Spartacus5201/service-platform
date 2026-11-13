import { redirect } from 'next/navigation';
import { getSession } from '@/src/server/session';
import LoginForm from './form';
import { getDb } from '@/src/server/db';

export default async function LoginPage() {
  if (await getSession()) redirect('/');
  const users = Number((await (await getDb()).query<{ n: string }>(`SELECT count(*) n FROM app_user`)).rows[0].n);
  if (!users) redirect('/setup');
  return (
    <div className="login card">
      <h1>Service Platform</h1>
      <p className="sub">Sign in to continue.</p>
      <LoginForm />
    </div>
  );
}
