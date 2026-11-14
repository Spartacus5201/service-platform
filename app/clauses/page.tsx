import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { saveClause } from '../server-actions/catalog';
import { Badge, Flash, one, type SP } from '../ui';

export default async function Clauses({ searchParams }: { searchParams: SP }) {
  await requireCan('clauses.edit');
  const sp = await searchParams;
  const rows = (await (await getDb()).query<{ key: string; title: string; body: string; applies_when: { types?: string[]; audience?: string } | null; version: number }>(
    `SELECT DISTINCT ON (key) key,title,body,applies_when,version FROM clause_template WHERE active ORDER BY key, version DESC`)).rows;
  return (
    <>
      <h1>Clauses</h1>
      <p className="sub">Standard text merged into documents when they are issued. Saving a key again creates a new version; issued documents keep the text they were issued with. Merge fields: {'{{property.name}}'}, {'{{property.classId}}'}, {'{{document.number}}'}, {'{{document.quoteValidUntil}}'}.</p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      {rows.map((c) => (
        <details key={c.key} className="card">
          <summary><b>{c.title}</b> <span className="small">{c.key} · v{c.version}</span> {c.applies_when?.types?.map((t) => <Badge key={t}>{t}</Badge>)} {c.applies_when?.audience && <Badge tone="info">{c.applies_when.audience} only</Badge>}</summary>
          <form action={saveClause}>
            <input type="hidden" name="key" value={c.key} />
            <div className="field"><label>Title</label><input name="title" defaultValue={c.title} /></div>
            <div className="field"><label>Text</label><textarea name="body" defaultValue={c.body} /></div>
            <div className="row">
              {['WA', 'Proposal', 'RFM'].map((t) => <label key={t}><input type="checkbox" name="types" value={t} defaultChecked={!c.applies_when?.types || c.applies_when.types.includes(t)} /> {t}</label>)}
              <select name="audience" defaultValue={c.applies_when?.audience ?? ''} aria-label="Audience"><option value="">both copies</option><option value="client">client copy only</option><option value="tech">technician copy only</option></select>
            </div>
            <div className="actions"><button type="submit">Save new version</button></div>
          </form>
        </details>
      ))}
      <form action={saveClause} className="card">
        <h2 style={{ marginTop: 0 }}>New clause</h2>
        <div className="row"><div className="field"><label htmlFor="key">Key</label><input id="key" name="key" required placeholder="payment_terms" /></div>
          <div className="field" style={{ flex: 2 }}><label htmlFor="title">Title</label><input id="title" name="title" required /></div></div>
        <div className="field"><label htmlFor="body">Text</label><textarea id="body" name="body" required /></div>
        <div className="row">{['WA', 'Proposal', 'RFM'].map((t) => <label key={t}><input type="checkbox" name="types" value={t} defaultChecked /> {t}</label>)}
          <select name="audience" defaultValue="" aria-label="Audience"><option value="">both copies</option><option value="client">client copy only</option><option value="tech">technician copy only</option></select></div>
        <div className="actions"><button type="submit">Add clause</button></div>
      </form>
    </>
  );
}
