import './globals.css';
import type { ReactNode } from 'react';
import { getSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { logout } from './actions';

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
            <nav><a href="/">Properties</a>{can(s.role, 'edit_prices') && <a href="/catalog">Catalog</a>}{can(s.role, 'edit_documents') && <a href="/clauses">Clauses</a>}{can(s.role, 'manage_users') && <a href="/admin">Admin</a>}</nav>
            <form action="/search" method="get" role="search" className="search"><input name="q" type="search" placeholder="Search units, IDs, cases…" aria-label="Search" /></form>
            <div className="who">
              <span>{s.name} · {s.role}</span>
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
