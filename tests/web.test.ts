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
const ROLE_KEYS = ['admin', 'manager', 'coordinator', 'scheduler', 'technician', 'billing'] as const;
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
  for (const role of ROLE_KEYS)
    users[role] = await createUser(w.db, { email: `${role}@x.io`, name: role, roles: [role], password: 'Password-1234', mustChangePassword: false });
}, 60000);


describe('download routes refuse the wrong role', () => {
  const routes: { file: string; params: () => Record<string, string>; url: string; allowed: Role[] }[] = [
    { file: 'aar/route', params: () => ({}), url: 'http://t/aar?visit=00000000-0000-0000-0000-000000000000', allowed: ['admin', 'manager', 'coordinator', 'scheduler', 'billing'] },
    { file: 'admin/backup/route', params: () => ({}), url: 'http://t/admin/backup', allowed: ['admin'] },
    { file: 'documents/[id]/pdf/route', params: () => ({ id: '00000000-0000-0000-0000-000000000000' }), url: 'http://t/x?copy=client', allowed: ['manager', 'coordinator', 'scheduler', 'billing'] },
    { file: 'properties/[id]/audits/[batchId]/export/route', params: () => ({ id: w.pid, batchId: w.batchId }), url: 'http://t/x?format=csv', allowed: ['manager', 'coordinator'] },
    { file: 'properties/[id]/battery/export/route', params: () => ({ id: w.pid }), url: 'http://t/x', allowed: ['manager', 'coordinator'] },
    { file: 'visits/[id]/export/route', params: () => ({ id: '00000000-0000-0000-0000-000000000000' }), url: 'http://t/x?kind=invoice', allowed: ['manager', 'billing'] },
    { file: 'visits/[id]/ids/export/route', params: () => ({ id: '00000000-0000-0000-0000-000000000000' }), url: 'http://t/x', allowed: ['manager', 'coordinator'] },
    { file: 'visits/[id]/photo/[photoId]/route', params: () => ({ id: '00000000-0000-0000-0000-000000000000', photoId: '00000000-0000-0000-0000-000000000000' }), url: 'http://t/x', allowed: ['admin', 'manager', 'coordinator', 'scheduler', 'billing'] },
  ];
  for (const r of routes) it(r.file, async () => {
    const { GET } = await import(`../app/${r.file}`);
    for (const role of [null, ...ROLE_KEYS] as (Role | null)[]) {
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
  it('each role is refused what it may not do', async () => {
    const { importReport } = await import('../app/server-actions/imports');
    const { createDocumentAction } = await import('../app/server-actions/documents');
    const { closeJobAction, createJobAction } = await import('../app/server-actions/jobs');
    const { createJob } = await import('../src/jobs/jobs');
    const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
    for (const role of ['scheduler', 'billing', 'technician'] as Role[]) {
      await signInAs(role);
      expect([role, await redirectOf(importReport({}, fd({ property_id: w.pid })))]).toEqual([role, expect.stringMatching(/role cannot do that/)]);
      expect([role, await redirectOf(createDocumentAction(fd({ property_id: w.pid, type: 'WA' })))]).toEqual([role, expect.stringMatching(/role cannot do that/)]);
      expect([role, await redirectOf(createJobAction(fd({ property_id: w.pid, title: 'x' })))]).toEqual([role, expect.stringMatching(/role cannot do that/)]);
    }
    // closing a job early is the Manager's
    const job = await createJob(w.db, { propertyId: w.pid, title: 'J', requestedOn: '2026-11-01' });
    await signInAs('coordinator');
    expect(await redirectOf(closeJobAction(fd({ job_id: job, early: '1', close_reason: 'client cancelled' })))).toMatch(/needs the Manager role/);
    await signInAs('manager');
    expect(await redirectOf(closeJobAction(fd({ job_id: job, early: '1', close_reason: 'client cancelled' })))).toMatch(/Job closed/);
  }, 60000);

  it('a technician cannot import a report', async () => {
    const { importReport } = await import('../app/server-actions/imports');
    await signInAs('technician');
    const fd = new FormData(); fd.set('property_id', w.pid);
    expect(await redirectOf(importReport({}, fd))).toMatch(/role cannot do that/);
  });

  it('A7: a coordinator\'s save keeps the shipping and cannot set prices; a manager can', async () => {
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
    await signInAs('manager');
    await redirectOf(saveLinesAction(form('90')));
    expect((await w.db.query<{ p: string }>(`SELECT unit_price::text p FROM document_line WHERE id=$1`, [line])).rows[0].p).toBe('90.00');
  }, 60000);
});

describe('own records (technicians)', () => {
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  let mine = ''; let theirs = '';
  beforeAll(async () => {
    const { recordVisitAction } = await import('../app/server-actions/field');
    await signInAs('technician');
    const ep = await w.ep('102');
    // a technician cannot record a visit in someone else's name: it is theirs whatever is typed
    await redirectOf(recordVisitAction({}, fd({ endpoint_id: ep, property_id: w.pid, technician: 'Not Me', visited_on: '2026-11-10', outcome: 'completed', action: 'inspect_test' })));
    mine = (await w.db.query<{ id: string }>(`SELECT id FROM visit WHERE technician_id=$1`, [users.technician])).rows[0]?.id ?? '';
    const { recordVisit } = await import('../src/service/record');
    theirs = (await recordVisit(w.db, { propertyId: w.pid, visitedOn: '2026-11-09', technician: 'Other Tech', outcome: 'completed', events: [{ endpointId: ep, action: 'inspect_test' }] })).visitId;
  }, 60000);
  it('the visit a technician records is theirs', () => { expect(mine).not.toBe(''); });
  it('the after action report: their own visit only, never a whole WA', async () => {
    const { GET } = await import('../app/aar/route');
    await signInAs('technician');
    expect((await GET(new Request(`http://t/aar?visit=${mine}`))).status).toBe(200);
    expect((await GET(new Request(`http://t/aar?visit=${theirs}`))).status).toBe(403);
    expect((await GET(new Request(`http://t/aar?document=${mine}`))).status).toBe(403);
    await signInAs('scheduler');
    expect((await GET(new Request(`http://t/aar?visit=${theirs}`))).status).toBe(200);
  }, 60000);
  it('photos: only on their own visits', async () => {
    const { addPhotoAction } = await import('../app/server-actions/field');
    await signInAs('technician');
    const photo = (id: string) => { const f = fd({ visit_id: id }); f.set('photo', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'a.jpg', { type: 'image/jpeg' })); return f; };
    expect(await redirectOf(addPhotoAction(photo(theirs)))).toMatch(/role cannot do that|not allowed|not yours|your own/i);
  }, 60000);
});

describe('lists', () => {
  it('only list editors change lists, and the page is theirs', async () => {
    const { saveListItemAction } = await import('../app/server-actions/lists');
    const f = () => { const x = new FormData(); x.set('list', 'job_source'); x.set('label', 'Walk-in'); x.set('active', 'on'); return x; };
    for (const role of ['coordinator', 'scheduler', 'technician', 'billing'] as Role[]) {
      await signInAs(role);
      expect([role, await redirectOf(saveListItemAction(f()))]).toEqual([role, expect.stringMatching(/role cannot do that/)]);
    }
    await signInAs('manager');
    expect(await redirectOf(saveListItemAction(f()))).toMatch(/Added/);
    expect(await redirectOf(saveListItemAction(f()))).toMatch(/already on the list/);
  });
});

describe('audit rules', () => {
  it('only rule editors test and save rules, and saving needs a tested draft', async () => {
    const { testRulesAction, saveRulesAction } = await import('../app/server-actions/rules');
    for (const role of ['coordinator', 'scheduler', 'technician', 'billing'] as Role[]) {
      await signInAs(role);
      expect([role, await redirectOf(saveRulesAction())]).toEqual([role, expect.stringMatching(/role cannot do that/)]);
    }
    await signInAs('manager');
    expect(await redirectOf(saveRulesAction())).toMatch(/Test the changes first/);
    const f = new FormData(); f.set('code', 'NEG');
    for (const [k, v] of Object.entries({ comp_NEG: 'none', method_NEG: 'standard', oa_NEG: 'Investigate', oo_NEG: 'property', or_NEG: 'Negative usage', va_NEG: 'Investigate', vo_NEG: 'property', vr_NEG: 'Negative usage' })) f.set(k, v);
    expect(await redirectOf(testRulesAction(f))).toMatch(/tested=1/);
    expect(await redirectOf(saveRulesAction())).toMatch(/Rules saved for NEG/);
    const { loadRules } = await import('../src/rules/table');
    expect((await loadRules(w.db)).NEG.occupied.owner).toBe('property');
  }, 60000);
});

describe('setup file', () => {
  it('only Admin exports and imports the setup; an import is previewed, then applied', async () => {
    const { GET } = await import('../app/admin/setup/export/route');
    const { previewSetupAction, importSetupAction } = await import('../app/server-actions/setup');
    for (const role of ['manager', 'coordinator', 'technician', 'billing'] as Role[]) {
      await signInAs(role);
      expect([role, (await GET()).status]).toEqual([role, 403]);
      expect([role, await redirectOf(importSetupAction())]).toEqual([role, expect.stringMatching(/role cannot do that/)]);
    }
    await signInAs('admin');
    const res = await GET(); expect(res.status).toBe(200);
    const f = JSON.parse(await res.text());
    f.sections.settings = f.sections.settings.map((r: { key: string }) => (r.key === 'labor_rate' ? { ...r, value: 101 } : r));
    const fd = new FormData(); fd.set('file', new File([JSON.stringify(f)], 'setup.json', { type: 'application/json' }));
    expect(await redirectOf(previewSetupAction(fd))).toMatch(/#preview/);
    expect((await w.db.query<{ v: unknown }>(`SELECT value v FROM setting WHERE key='labor_rate'`)).rows[0]?.v).not.toBe(101);   // not yet
    expect(await redirectOf(importSetupAction())).toMatch(/Setup imported: 1 change/);
    expect((await w.db.query<{ v: unknown }>(`SELECT value v FROM setting WHERE key='labor_rate'`)).rows[0].v).toBe(101);
    const bad = new FormData(); bad.set('file', new File(['nope'], 'x.json'));
    expect(await redirectOf(previewSetupAction(bad))).toMatch(/not a setup file/);
  }, 60000);
});
