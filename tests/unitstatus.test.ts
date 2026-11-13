import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { buildDemo } from '../src/dev/demo';
import { stageOf, stagedLines, latestAuditBatch, countStages } from '../src/service/unitstatus';

describe('stageOf', () => {
  const ev = (visitedOn: string, result: string | null = 'replaced', outcome = 'completed') => ({ visitedOn, result, outcome });
  it('needs a document when nothing has happened', () => expect(stageOf('2026-10-01', null, null)).toBe('needs_document'));
  it('is on a document until a visit', () => expect(stageOf('2026-10-01', { createdOn: '2026-11-02' }, null)).toBe('on_document'));
  it('is visited when the audit window started before the visit', () => expect(stageOf('2026-10-01', { createdOn: '2026-11-02' }, ev('2026-11-05'))).toBe('visited'));
  it('is not fixed when a later audit still flags it', () => expect(stageOf('2026-11-06', { createdOn: '2026-11-02' }, ev('2026-11-05'))).toBe('not_fixed'));
  it('needs a revisit when access failed', () => expect(stageOf('2026-10-01', null, ev('2026-11-05', 'unable_to_access'))).toBe('revisit'));
  it('is back on a document when re-quoted after the visit', () => expect(stageOf('2026-11-06', { createdOn: '2026-11-10' }, ev('2026-11-05'))).toBe('on_document'));
});

describe('unit stages on the demo data', () => {
  it('stages every flagged unit and links the visit to its WA', async () => {
    const db = await openDb();
    await buildDemo(db);
    const maple = (await db.query<{ id: string }>(`SELECT id FROM property WHERE class_id='9910001'`)).rows[0].id;
    const b = (await latestAuditBatch(db, maple))!;
    const lines = await stagedLines(db, b.id, '2026-11-13');
    const c = countStages(lines);
    expect(c.not_fixed).toBeGreaterThan(0);                // the later audit still flags serviced units
    expect(lines.every((l) => l.stage)).toBe(true);
    const v = (await db.query<{ n: string }>(`SELECT count(*) n FROM visit v JOIN document d ON d.id=v.document_id WHERE v.property_id=$1`, [maple])).rows[0];
    expect(Number(v.n)).toBe(1);
  }, 120000);
});
