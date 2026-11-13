import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { buildDemo } from '../src/dev/demo';
import { salesforce, salesforceMode, liveClient, statusLine, SalesforceError, type Fetch } from '../src/salesforce/client';
import { refreshFromSalesforce, jobDetail, JobError } from '../src/jobs/jobs';

describe('Salesforce lookup', () => {
  it('is off unless turned on, and refuses live mode without credentials', () => {
    expect(salesforceMode({})).toBe('off');
    expect(salesforce({})).toBeNull();
    expect(salesforce({ SF_MODE: 'mock' })!.mode).toBe('mock');
    expect(() => salesforce({ SF_MODE: 'live', SF_DOMAIN: 'https://x.my.salesforce.com' })).toThrow(SalesforceError);
  });

  it('live client only signs in and makes GET queries (read-only)', async () => {
    const calls: { url: string; method: string }[] = [];
    const fake: Fetch = async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/services/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'T', instance_url: 'https://x.my.salesforce.com' }), text: async () => '' };
      return { ok: true, status: 200, text: async () => '', json: async () => ({ records: [{ CaseNumber: '00812345', Status: 'Work Scheduled', Subject: 'S', LastModifiedDate: null, Account: { Id: 'A1', Name: 'Acct' },
        WorkOrders: { records: [{ WorkOrderNumber: '00045678', Status: 'Scheduled', StartDate: '2026-11-18T08:00:00Z' }] } }] }) };
    };
    const c = liveClient({ domain: 'https://x.my.salesforce.com', clientId: 'id', clientSecret: 'secret', version: '62.0' }, fake);
    const r = await c.getCase('00812345');
    await c.getCase('00812345');
    expect(statusLine(r!)).toBe('Work Scheduled · WO 00045678 Scheduled 2026-11-18');
    expect(calls.filter((x) => x.method === 'POST').map((x) => x.url)).toEqual(['https://x.my.salesforce.com/services/oauth2/token']);   // token reused
    expect(calls.filter((x) => x.method !== 'POST').every((x) => x.method === 'GET' && x.url.includes('/services/data/v62.0/query?q=SELECT'))).toBe(true);
    await expect(c.getCase("1' OR Id != '")).rejects.toThrow(SalesforceError);         // only digits reach the query
  });

  it('copies the case status onto a job and warns when the case is on another account', async () => {
    const db = await openDb();
    await buildDemo(db);
    const client = salesforce({ SF_MODE: 'mock' })!;
    const maple = (await db.query<{ id: string }>(`SELECT id FROM job WHERE salesforce_case='00812345'`)).rows[0].id;
    expect(await refreshFromSalesforce(db, maple, client)).toEqual({ status: 'Work Scheduled · WO 00045678 Completed 2026-11-05', warning: null });
    expect((await jobDetail(db, maple))!.salesforceSyncedAt).not.toBeNull();
    const cedar = (await db.query<{ id: string }>(`SELECT id FROM job WHERE salesforce_case='00813077'`)).rows[0].id;
    await db.query(`UPDATE job SET salesforce_case='00812999' WHERE id=$1`, [cedar]);           // Harbor View's case on a Cedar Court job
    expect((await refreshFromSalesforce(db, cedar, client)).warning).toMatch(/Harbor View Lofts/);
    await db.query(`UPDATE job SET salesforce_case='00000001' WHERE id=$1`, [cedar]);
    await expect(refreshFromSalesforce(db, cedar, client)).rejects.toThrow(JobError);
  }, 120000);
});
