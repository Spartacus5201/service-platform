import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { buildDemo } from '../src/dev/demo';
import { aarForVisit, aarForDocument, postAuditsDue } from '../src/service/aar';
import { renderAarPdf } from '../src/service/pdf';

describe('post-service audit and After Action Report', () => {
  it('compares before and after for every serviced unit', async () => {
    const db = await openDb();
    await buildDemo(db);
    const v = (await db.query<{ id: string; document_id: string }>(`SELECT v.id, v.document_id FROM visit v JOIN property p ON p.id=v.property_id WHERE p.class_id='9910001'`)).rows[0];
    const a = await aarForVisit(db, v.id);
    expect(a.rows.length).toBe(3);
    expect(a.rows.every((r) => r.before.code)).toBe(true);           // the audit that flagged it
    expect(a.summary.fixed).toBe(1);                                   // replaced transmitter now reads OK
    expect(a.summary.still_failing + a.summary.new_problem).toBe(2);
    expect(a.summary.units).toBe(3);
    expect(a.postAuditDue).toBe('2026-11-12');
    const w = await aarForDocument(db, v.document_id);
    expect(w.rows.length).toBe(3);
    const pdf = await renderAarPdf(a, '2026-11-13');
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
  }, 120000);

  it('lists visits whose post-service audit is overdue', async () => {
    const db = await openDb();
    await buildDemo(db);
    const due = await postAuditsDue(db, '2026-11-25');
    const names = due.map((d) => d.property);
    expect(names).toContain('Harbor View Lofts');      // visited 11-10, no audit since
    expect(names).not.toContain('Maple Ridge Apartments'); // later audit covers it
  }, 120000);
});
