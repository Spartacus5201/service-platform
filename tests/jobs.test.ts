import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { buildDemo } from '../src/dev/demo';
import { listJobs, jobDetail, createJob, closeJob, reopenJob, attachAudit, JobError } from '../src/jobs/jobs';
import { createDocument } from '../src/documents/build';

describe('jobs', () => {
  it('derives each demo job stage from its linked records', async () => {
    const db = await openDb();
    await buildDemo(db);
    const jobs = await listJobs(db);
    const by = (t: string) => jobs.find((j) => j.title === t)!;
    expect(by('Resident disputes high water bill').stage).toBe('requested');
    expect(by('Two units not transmitting').stage).toBe('serviced');          // notes waiting for approval
    expect(by('MSA quarterly service').stage).toBe('to_invoice');             // approved, not sent
    const maple = by('Quarterly audit follow-up');
    expect(maple.stage).toBe('follow_up');                                    // later audit shows units still failing
    expect(maple.audits).toHaveLength(2);
    expect(maple.documents.map((d) => d.type)).toEqual(['WA']);
    expect(maple.visits[0].invoiceRef).toBe('ADM-2026-114');
    expect(maple.money.quoted).toBeGreaterThanOrEqual(0);
    expect(maple.timeline.map((t) => t.what)).toEqual(expect.arrayContaining(['Requested', 'Audit imported', 'WA drafted', 'WA issued', 'Service visit', 'Client notes approved', 'Sent for invoicing', 'ID update sent to billing']));
    expect(maple.outcomes.fixed).toBe(1);
  }, 120000);

  it('starts a job from an audit when a document is drafted without one, and closes with a reason', async () => {
    const db = await openDb();
    await buildDemo(db);
    const cedar = (await db.query<{ id: string }>(`SELECT id FROM property WHERE class_id='9910003'`)).rows[0].id;
    const d = await createDocument(db, { propertyId: cedar, type: 'RFM', title: 'Plumbing', createdOn: '2026-11-13' });
    const jid = (await db.query<{ job_id: string }>(`SELECT job_id FROM document WHERE id=$1`, [d.documentId])).rows[0].job_id;
    expect((await jobDetail(db, jid))!.stage).toBe('drafting');
    await expect(closeJob(db, jid, '2026-11-13', null, true)).rejects.toThrow(JobError);
    await closeJob(db, jid, '2026-11-13', 'Property will handle it', true);
    expect((await jobDetail(db, jid))!.stage).toBe('closed');
    expect((await listJobs(db, { propertyId: cedar })).some((j) => j.id === jid)).toBe(false);
    await reopenJob(db, jid);
    expect((await jobDetail(db, jid))!.stage).toBe('drafting');
    // An audit can only belong to one job.
    const other = await createJob(db, { propertyId: cedar, title: 'Another', requestedOn: '2026-11-13' });
    const batch = (await db.query<{ id: string }>(`SELECT id FROM import_batch WHERE property_id=$1 AND job_id IS NOT NULL LIMIT 1`, [cedar])).rows[0].id;
    await expect(attachAudit(db, other, batch)).rejects.toThrow(/another job/);
  }, 120000);
});
