import { getDb } from '@/src/server/db';
import { requireSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { search, type Hit, type HitKind } from '@/src/search/search';
import { Badge, one, type SP } from '../ui';

const GROUPS: [HitKind, string][] = [['property', 'Properties'], ['unit', 'Units'], ['device', 'Devices'], ['service', 'Service history'], ['document', 'Documents']];

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const s = await requireSession();
  const q = (one((await searchParams).q) ?? '').trim();
  const hits: Hit[] = q ? await search(await getDb(), q, { includeDocuments: can(s.role, 'edit_documents') }) : [];
  return (
    <>
      <h1>Search</h1>
      <form action="/search" method="get" className="card" role="search">
        <div className="row"><div className="field" style={{ flex: 3 }}><label htmlFor="q">Find</label><input id="q" name="q" defaultValue={q} autoFocus placeholder="1-101, a transmitter ID, a Case number, “leak”…" /></div>
          <div className="field"><button type="submit">Search</button></div></div>
        <p className="small" style={{ margin: 0 }}>Every word must match. Searches names, addresses, unit numbers, device IDs and serials, visit notes, Case and Work Order numbers{can(s.role, 'edit_documents') ? ', and documents' : ''}.</p>
      </form>
      {q && !hits.length && <div className="card">Nothing matches “{q}”.{q.trim().length < 2 ? ' Type at least two characters.' : ''}</div>}
      {GROUPS.map(([k, label]) => {
        const rows = hits.filter((h) => h.kind === k);
        return rows.length ? (
          <section key={k}>
            <h2>{label} <Badge>{rows.length}</Badge></h2>
            <div className="card" style={{ padding: 0 }}><ul className="results">
              {rows.map((h, i) => (<li key={i}><a href={h.href}>{h.title}</a><div className="small">{h.sub}</div>{h.note && <div className="small">“{h.note.length > 160 ? h.note.slice(0, 160) + '…' : h.note}”</div>}</li>))}
            </ul></div>
          </section>
        ) : null;
      })}
    </>
  );
}
