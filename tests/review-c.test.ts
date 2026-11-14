// Code review group C (docs/REVIEW-2026-11.md): hardening before the company server.
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { openDb } from '../src/db';
import { readWorkbook, ParseError, XLSX_LIMITS } from '../src/parsers/common';
import { authenticate, createUser, changePassword, LoginLockedError, LOGIN_LIMITS } from '../src/auth/auth';
import { createFirstAdmin, issueSetupCode, SetupDoneError } from '../src/auth/setup';
import { resetPassword } from '../src/admin/admin';
import { auditCsv } from '../src/review/export';
import { renderPdf } from '../src/documents/pdf';
import { forTechnician, renderDocumentHtml, type FrozenContent } from '../src/documents/render';
import type { AuditLine } from '../src/queries/audit';

const content = (price: number, shipping: number): FrozenContent => ({
  number: '9900001-261110', type: 'Proposal', actsAs: null, title: 'P', version: 1, issuedOn: '2026-11-10', quoteValidUntil: null,
  property: { name: 'Synthetic Gardens', classId: '9900001', address: '1 Synthetic Way', accessNotes: null, schedulingNotes: null },
  salesforceCase: null, salesforceWorkOrder: null, shipping,
  clauses: [{ key: 'a', title: 'Terms', body: 'Valid 30 days.' }, { key: 'b', title: 'Client only', body: 'Pay within 30 days.', audience: 'client' }],
  lines: [{ building: '1', unit: '101', address: 'x', service: 'WS', issueCode: 'NT', description: 'Replace transmitter', component: 'transmitter', quantity: 2, unitPrice: price, laborPrice: price / 2, laborCovered: false, partCovered: false, include: true }],
});

describe('review C: security', () => {
  it('C1: a workbook that unpacks past the limit is refused before it is read', async () => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', ' '.repeat(XLSX_LIMITS.totalBytes + 1024));
    const bomb = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    await expect(readWorkbook(bomb)).rejects.toThrow(/unpacks to/);
    await expect(readWorkbook(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(ParseError);
  }, 60000);

  it('C2: a password change or an admin reset ends existing sessions', async () => {
    const db = await openDb();
    const id = await createUser(db, { email: 'a@x.io', name: 'A', role: 'admin', password: 'Password-1234', mustChangePassword: false });
    const v = async () => (await db.query<{ v: number }>(`SELECT session_version v FROM app_user WHERE id=$1`, [id])).rows[0].v;
    const v0 = await v();
    await changePassword(db, id, 'Password-1234', 'Password-5678');
    expect(await v()).toBe(v0 + 1);
    await resetPassword(db, null, id);
    expect(await v()).toBe(v0 + 2);
  }, 60000);

  it('C4: repeated failed sign-ins are refused for a while', async () => {
    const db = await openDb();
    await createUser(db, { email: 'a@x.io', name: 'A', role: 'admin', password: 'Password-1234', mustChangePassword: false });
    for (let i = 0; i < LOGIN_LIMITS.perEmail; i++) expect(await authenticate(db, 'a@x.io', 'wrong-password')).toBeNull();
    await expect(authenticate(db, 'a@x.io', 'Password-1234')).rejects.toBeInstanceOf(LoginLockedError);
    expect(await authenticate(db, 'other@x.io', 'nope')).toBeNull();          // other accounts are unaffected
  }, 60000);

  it('C5: the first admin needs the setup code, and only one can be created', async () => {
    const db = await openDb();
    const lines: string[] = [];
    const code = (await issueSetupCode(db, (s) => lines.push(s)))!;
    expect(lines.join('')).toContain(code);
    expect(JSON.stringify((await db.query(`SELECT value FROM setting WHERE key='setup_code_hash'`)).rows)).not.toContain(code);
    await expect(createFirstAdmin(db, 'WRONGCODE', { email: 'a@x.io', name: 'A', password: 'Password-1234' })).rejects.toThrow(/setup code/);
    const r = await Promise.allSettled([
      createFirstAdmin(db, code.toLowerCase(), { email: 'a@x.io', name: 'A', password: 'Password-1234' }),
      createFirstAdmin(db, code, { email: 'b@x.io', name: 'B', password: 'Password-1234' }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((x) => x.status === 'rejected')).toMatchObject({ reason: expect.any(SetupDoneError) });
    expect(await issueSetupCode(db, () => {})).toBeNull();
  }, 60000);

  it('C7: the audit CSV never carries a formula', () => {
    const line = { building: '1', unit: '101', address: '=HYPERLINK("http://x")', service: 'WS', code: 'NT', recommendation: { action: 'Needs Service' }, rules: { action: 'Needs Service' },
      override: { reason: '@SUM(A1)', by: null, at: '' } } as unknown as AuditLine;
    const csv = auditCsv([line]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(`'@SUM(A1)`);
  });

  it('C8: the technician copy has no prices, shipping or client-only clauses, in HTML and PDF alike', async () => {
    const t = forTechnician(content(85, 25));
    expect(t.lines[0]).toMatchObject({ unitPrice: null, laborPrice: null }); expect(t.shipping).toBeNull();
    expect(t.clauses.map((c) => c.key)).toEqual(['a']);
    const html = renderDocumentHtml(content(12345.67, 999), 'tech');
    expect(html).not.toMatch(/12,345|12345|999|Pay within/);
    // The PDF of two documents that differ only in price is the same: no price reaches it.
    const strip = (b: Uint8Array) => Buffer.from(b).toString('latin1').replace(/\/CreationDate \(D:[^)]*\)/g, '').replace(/\/ID \[[^\]]*\]/g, '');
    expect(strip(await renderPdf(content(85, 25), 'tech'))).toBe(strip(await renderPdf(content(12345.67, 999), 'tech')));
    expect(strip(await renderPdf(content(85, 25), 'client'))).not.toBe(strip(await renderPdf(content(12345.67, 999), 'client')));
  }, 60000);
});
