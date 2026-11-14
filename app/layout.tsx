import './globals.css';
import type { ReactNode } from 'react';
import { getSession } from '@/src/server/session';
import { can, canAny, canOwn } from '@/src/auth/auth';
import { BUILTIN_ROLES, ADMIN_AREA } from '@/src/auth/permissions';
import { logout } from './server-actions/account';

export const metadata = { title: 'Service Platform' };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const s = await getSession();
  return (
    <html lang="en">
      <body>
        {s && !s.mustChangePassword && (
          <header className="topbar">
            <a className="brand" href="/">Service Platform</a>
            <nav><a href="/">Home</a>{canOwn(s, 'job.view') && <a href="/jobs">Jobs</a>}{can(s, 'price.edit') && <a href="/catalog">Catalog</a>}{can(s, 'price.view') && <a href="/equipment">Equipment</a>}{can(s, 'clauses.edit') && <a href="/clauses">Clauses</a>}{canAny(s, ADMIN_AREA) && <a href="/admin">Admin</a>}</nav>
            <form action="/search" method="get" role="search" className="search"><input name="q" type="search" placeholder="Search units, IDs, cases…" aria-label="Search" /></form>
            <div className="who">
              <span>{s.name} · {s.roles.map((r) => BUILTIN_ROLES.find((b) => b.key === r)?.name ?? r).join(', ') || 'no role'}</span>
              <a href="/account/password">Password</a>
              <form action={logout}><button className="link" type="submit">Sign out</button></form>
            </div>
          </header>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
