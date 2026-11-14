// The web layer: every download route refuses people whose role may not use it, technicians never get a priced
// copy, and server actions enforce price permission whatever the form sends. Next's request helpers are replaced
// by a cookie jar so the real route handlers and actions run against a test database.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { world, type World } from './helpers';
import { createUser, type Role } from '../src/auth/auth';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => { jar.set(k, v); },
    delete: (k: string) => { jar.delete(k); },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

process.env.SESSION_SECRET = 'test-secret-for-web-tests-only';
let w: World; const users = {} as Record<Role, string>;
const signInAs = async (role: Role | null) => {
  jar.clear();
  if (role) await (await import('../src/server/session')).startSession(users[role]);
};
const redirectOf = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { const d = String((e as { digest?: string }).digest ?? ''); if (!d.startsWith('NEXT_REDIRECT')) throw e; return decodeURIComponent(d.split(';')[2] ?? ''); }
};

beforeAll(async () => {
  w = await world();
  (globalThis as unknown as { __spDb?: Promise<unknown> }).__spDb = Promise.resolve(w.db);
  for (const role of ['admin', 'office', 'coordinator', 'technician'] as Role[])
    users[role] = await createUser(w.db, { email: `${role}@x.io`, name: role, role, password: 'Password-1234', mustChangePassword: false });
}, 60000);


describe('download routes refuse the wrong role', () => {
  const routes: { file: string; params: () => Record<string, string>; url: string; allowed: Role[] }[] = [
    { file: 'aar/route', params: () => ({}), url: 'http://t/aar?visit=00000000-0000-0000-0000-000000000000', allowed: ['admin', 'office', 'coordinator'] },
    { file: 'admin/backup/route', params: () => ({}), url: 'http://t/admin/backup', allowed: ['admin'] },
    { file: 'documents/[id]/pdf/route', params: () => ({ id: '00000000-0000-0000-0000-000000000000' }), url: 'http://t/x?copy=client', allowed: ['admin', 'office', 'coordinator'] },
    { file: 'properties/[id]/audits/[batchId]/export/route', params: () => ({ id: w.pid, batchId: w.batchId }), url: 'http://t/x?format=csv', allowed: ['admin', 'office', 'coordinator'] },
    { file: 'properties/[id]/battery/export/route', params: () => ({ id: w.pid }), url: 'http://t/x', allowed: ['admin', 'office', 'coordinator'] },
    { file: 'visits/[id]/export/route', params: () => ({ id: '00000000-0000-0000-0000-000000000000' }), url: 'http://t/x?kind=invoice', allowed: ['admin', 'office'] },
    { file: 'visits/[id]/ids/export/route', params: () => ({ id: '00000000-0000-0000-0000-000000000000' }), url: 'http://t/x', allowed: ['admin', 'office', 'coordinator'] },
    { file: 'visits/[id]/photo/[photoId]/route', params: () => ({ id: '00000000-0000-0000-0000-000000000000', photoId: '00000000-0000-0000-0000-000000000000' }), url: 'http://t/x', allowed: ['admin', 'office', 'coordinator'] },
  ];
  for (const r of routes) it(r.file, async () => {
    const { GET } = await import(`../app/${r.file}`);
    for (const role of [null, 'admin', 'office', 'coordinator', 'technician'] as (Role | null)[]) {
      await signInAs(role);
      const res: Response = await GET(new Request(r.url), { params: Promise.resolve(r.params()) }).catch((e: unknown) => ({ status: (e as Error).message.includes('NEXT_') ? 302 : 500 }) as Response);
      const refused = res.status === 403;
      expect([role, refused]).toEqual([role, !(role && r.allowed.includes(role))]);
    }
  }, 60000);
  it('a technician may fetch the technician copy of a document', async () => {
    const { GET } = await import('../app/documents/[id]/pdf/route');
    await signInAs('technician');
    const res = await GET(new Request('http://t/x?copy=tech'), { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) });
    expect(res.status).toBe(404);          // allowed; there is simply no such document
  });
  it('a signed-out cookie no longer works', async () => {
    const { GET } = await import('../app/admin/backup/route');
    await signInAs('admin'); const cookie = jar.get('sp_session')!;
    const { endSession } = await import('../src/server/session'); await endSession();
    jar.set('sp_session', cookie);
    expect((await GET()).status).toBe(403);
  });
});

describe('server actions', () => {
  it('a technician cannot import a report', async () => {
    const { importReport } = await import('../app/server-actions/imports');
    await signInAs('technician');
    const fd = new FormData(); fd.set('property_id', w.pid);
    expect(await redirectOf(importReport({}, fd))).toMatch(/role cannot do that/);
  });

  it('A7: a coordinator\'s save keeps the shipping and cannot set prices; an office user can', async () => {
    const { createDocument } = await import('../src/documents/build');
    const { saveLinesAction } = await import('../app/server-actions/documents');
    const d = await createDocument(w.db, { propertyId: w.pid, type: 'Proposal', createdOn: '2026-11-13' });
    const line = (await w.db.query<{ id: string }>(`INSERT INTO document_line (version_id,description,quantity,unit_price,include) VALUES ($1,'Transmitter',1,80,true) RETURNING id`, [d.versionId])).rows[0].id;
    await w.db.query(`UPDATE document SET shipping=25 WHERE id=$1`, [d.documentId]);
    const form = (price: string) => { const fd = new FormData();
      fd.set('document_id', d.documentId); fd.set('version_id', d.versionId); fd.append('line', line);
      fd.set(`desc_${line}`, 'Transmitter'); fd.set(`qty_${line}`, '1'); fd.set(`inc_${line}`, 'on'); fd.set(`price_${line}`, price);
      fd.set('new_desc', 'Extra'); fd.set('new_price', price); fd.set('shipping', ''); return fd; };
    await signInAs('coordinator');
    expect(await redirectOf(saveLinesAction(form('0.01')))).toMatch(/Draft saved/);
    const after = await w.db.query<{ description: string; unit_price: string | null }>(`SELECT description, unit_price::text FROM document_line WHERE version_id=$1 ORDER BY description DESC`, [d.versionId]);
    expect(after.rows.map((r) => [r.description, r.unit_price])).toEqual([['Transmitter', '80.00'], ['Extra', null]]);
    expect((await w.db.query<{ s: string }>(`SELECT shipping::text s FROM document WHERE id=$1`, [d.documentId])).rows[0].s).toBe('25.00');
    await signInAs('office');
    await redirectOf(saveLinesAction(form('90')));
    expect((await w.db.query<{ p: string }>(`SELECT unit_price::text p FROM document_line WHERE id=$1`, [line])).rows[0].p).toBe('90.00');
  }, 60000);
});
