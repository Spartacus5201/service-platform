import { redirect } from 'next/navigation';
import { getDb } from '@/src/server/db';
import { firstAdminAction } from '../actions';
import { Flash, one, type SP } from '../ui';

/** First run only: create the first administrator. Disappears once any user exists. */
export default async function Setup({ searchParams }: { searchParams: SP }) {
  const n = Number((await (await getDb()).query<{ n: string }>(`SELECT count(*) n FROM app_user`)).rows[0].n);
  if (n > 0) redirect('/login');
  const sp = await searchParams;
  return (
    <div className="login card">
      <h1>Set up Service Platform</h1>
      <p className="sub">Create the first administrator. You can add everyone else from Admin afterwards.</p>
      <Flash error={one(sp.error)} />
      <form action={firstAdminAction}>
        <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" required /></div>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required /></div>
        <div className="field"><label htmlFor="password">Password (at least 10 characters)</label><input id="password" name="password" type="password" minLength={10} required /></div>
        <div className="field"><label htmlFor="again">Password again</label><input id="again" name="again" type="password" minLength={10} required /></div>
        <div className="actions"><button type="submit">Create administrator</button></div>
      </form>
    </div>
  );
}
