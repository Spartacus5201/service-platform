import { describe, it, expect, beforeAll } from 'vitest';
import JSZip from 'jszip';
import { openDb } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { synthUnits, synthAutoAudit, SYNTH_CLASS_ID } from '../src/dev/synthetic';
import { auditLines } from '../src/queries/audit';
import { setOverride, clearOverride, ReviewError } from '../src/review/overrides';
import { auditCsv, auditXlsx, caseZip } from '../src/review/export';
import { createDocument } from '../src/documents/build';

describe('reviewer overrides and exports', () => {
  let db: Awaited<ReturnType<typeof openDb>>; let pid: string; let batch: string; let asOf = '2026-11-06';
  beforeAll(async () => {
    db = await openDb();
    pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ($1,'T') RETURNING id`, [SYNTH_CLASS_ID])).rows[0].id;
    const bytes = new Uint8Array([1, 2, 3]);
    const r = await importParsed(db, pid, parseAutoAudit(synthAutoAudit(synthUnits())), { createMissing: true, filename: 'a.xlsx', fileBytes: bytes });
    batch = r.batchId!;
  }, 60000);

  it('applies an override everywhere downstream and keeps the rules answer', async () => {
    const lines = await auditLines(db, batch, asOf);
    const ok = lines.find((l) => l.recommendation.action === 'No action')!;
    expect(await setOverride(db, ok.readingId, { action: 'Needs Service', component: 'meter', reason: 'tenant reported a leak' }, null, ok.rules)).toBe('saved');
    const after = (await auditLines(db, batch, asOf)).find((l) => l.readingId === ok.readingId)!;
    expect(after.recommendation).toMatchObject({ action: 'Needs Service', component: 'meter' });
    expect(after.rules.action).toBe('No action');
    expect(after.override?.reason).toBe('tenant reported a leak');
    const doc = await createDocument(db, { propertyId: pid, type: 'WA', createdOn: asOf, fromAuditBatch: batch });
    const lineCount = (await db.query(`SELECT 1 FROM document_line WHERE audit_reading_id=$1`, [ok.readingId])).rows.length;
    expect(doc.lines).toBeGreaterThan(0); expect(lineCount).toBe(1);
  });
  it('requires a reason and removes an override that matches the rules', async () => {
    const l = (await auditLines(db, batch, asOf)).find((x) => x.override)!;
    await expect(setOverride(db, l.readingId, { action: 'No action', reason: ' ' }, null, l.rules)).rejects.toBeInstanceOf(ReviewError);
    expect(await setOverride(db, l.readingId, { action: 'No action', reason: 'back to normal' }, null, l.rules)).toBe('cleared');
    expect((await auditLines(db, batch, asOf)).find((x) => x.readingId === l.readingId)!.override).toBeNull();
    await clearOverride(db, l.readingId, null);
  });
  it('exports CSV and Excel with the final answer', async () => {
    const lines = await auditLines(db, batch, asOf);
    const t = lines.find((l) => l.recommendation.action === 'Investigate')!;
    await setOverride(db, t.readingId, { action: 'Needs Service', reason: 'confirmed on site, "dead" meter' }, null, t.rules);
    const fresh = await auditLines(db, batch, asOf);
    const csv = auditCsv(fresh);
    expect(csv.split('\r\n')[0]).toContain('Reviewer note');
    expect(csv).toContain('"confirmed on site, ""dead"" meter"');
    expect((await auditXlsx(fresh, 't')).length).toBeGreaterThan(1000);
  });
  it('builds a corpus case zip with raw files, expected rows and reviewer notes', async () => {
    const lines = await auditLines(db, batch, asOf);
    const z = await caseZip(db, batch, lines);
    expect(z.name).toMatch(/^real-9900001-/);
    const zip = await JSZip.loadAsync(z.bytes);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['case.json', 'expected.csv', 'reviewer-notes.csv']));
    expect(Object.keys(zip.files).some((f) => f.startsWith('raw/'))).toBe(true);
  });
});
