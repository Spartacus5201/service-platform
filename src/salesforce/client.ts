// Salesforce lookup, read-only. Three modes (SF_MODE):
//   off   (default) nothing is looked up; the Salesforce status on a job is typed in by hand
//   mock  built-in sample cases, for the demo and for building screens before access is granted
//   live  the company org, using the Client Credentials flow of an External Client App (docs/SALESFORCE-SETUP.md)
// Live settings: SF_DOMAIN (My Domain URL), SF_CLIENT_ID, SF_CLIENT_SECRET, SF_API_VERSION (default 62.0).
// Read-only by construction: the only requests this file can make are the token request and GET queries.
import { MOCK_CASES } from './mock';

export interface WorkOrderInfo { number: string; status: string; startDate: string | null }
export interface CaseInfo {
  caseNumber: string; status: string; subject: string | null;
  accountName: string | null; accountId: string | null; lastModified: string | null; workOrders: WorkOrderInfo[];
}
export interface SalesforceClient { mode: 'mock' | 'live'; getCase(caseNumber: string): Promise<CaseInfo | null> }
export class SalesforceError extends Error {}

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const CASE_NO = /^[0-9]{5,10}$/;

export function salesforceMode(env: Record<string, string | undefined> = process.env): 'off' | 'mock' | 'live' {
  const m = (env.SF_MODE ?? 'off').toLowerCase();
  return m === 'mock' || m === 'live' ? m : 'off';
}

/** The client for this server, or null when Salesforce lookups are off. */
export function salesforce(env: Record<string, string | undefined> = process.env, fetchFn: Fetch = fetch as unknown as Fetch): SalesforceClient | null {
  const mode = salesforceMode(env);
  if (mode === 'off') return null;
  if (mode === 'mock') return mockClient();
  const { SF_DOMAIN, SF_CLIENT_ID, SF_CLIENT_SECRET } = env;
  if (!SF_DOMAIN || !SF_CLIENT_ID || !SF_CLIENT_SECRET) throw new SalesforceError('Salesforce is set to live but SF_DOMAIN, SF_CLIENT_ID or SF_CLIENT_SECRET is missing.');
  return liveClient({ domain: SF_DOMAIN.replace(/\/+$/, ''), clientId: SF_CLIENT_ID, clientSecret: SF_CLIENT_SECRET, version: env.SF_API_VERSION ?? '62.0' }, fetchFn);
}

export function mockClient(): SalesforceClient {
  return { mode: 'mock', async getCase(n) { if (!CASE_NO.test(n.trim())) throw new SalesforceError('A case number is digits only, e.g. 00812345.'); return MOCK_CASES[n.trim()] ?? null; } };
}

export function liveClient(cfg: { domain: string; clientId: string; clientSecret: string; version: string }, fetchFn: Fetch): SalesforceClient {
  let token: { value: string; instance: string; until: number } | null = null;
  const auth = async () => {
    if (token && token.until > Date.now()) return token;
    const r = await fetchFn(`${cfg.domain}/services/oauth2/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
    });
    if (!r.ok) throw new SalesforceError(`Salesforce sign-in failed (${r.status}). Check the External Client App settings.`);
    const j = await r.json() as { access_token: string; instance_url?: string };
    token = { value: j.access_token, instance: (j.instance_url ?? cfg.domain).replace(/\/+$/, ''), until: Date.now() + 50 * 60 * 1000 };
    return token;
  };
  const query = async <T>(soql: string): Promise<T[]> => {
    const t = await auth();
    const r = await fetchFn(`${t.instance}/services/data/v${cfg.version}/query?q=${encodeURIComponent(soql)}`, { method: 'GET', headers: { authorization: `Bearer ${t.value}`, accept: 'application/json' } });
    if (r.status === 401) { token = null; throw new SalesforceError('Salesforce session expired; try again.'); }
    if (!r.ok) throw new SalesforceError(`Salesforce lookup failed (${r.status}).`);
    return ((await r.json()) as { records: T[] }).records;
  };
  return {
    mode: 'live',
    async getCase(n) {
      const num = n.trim();
      if (!CASE_NO.test(num)) throw new SalesforceError('A case number is digits only, e.g. 00812345.');
      type Row = { CaseNumber: string; Status: string; Subject: string | null; LastModifiedDate: string | null; Account: { Id: string; Name: string } | null;
        WorkOrders: { records: { WorkOrderNumber: string; Status: string; StartDate: string | null }[] } | null };
      const rows = await query<Row>(`SELECT CaseNumber, Status, Subject, LastModifiedDate, Account.Id, Account.Name, (SELECT WorkOrderNumber, Status, StartDate FROM WorkOrders ORDER BY CreatedDate) FROM Case WHERE CaseNumber = '${num}' LIMIT 1`);
      const c = rows[0]; if (!c) return null;
      return { caseNumber: c.CaseNumber, status: c.Status, subject: c.Subject, accountName: c.Account?.Name ?? null, accountId: c.Account?.Id ?? null, lastModified: c.LastModifiedDate,
        workOrders: (c.WorkOrders?.records ?? []).map((w) => ({ number: w.WorkOrderNumber, status: w.Status, startDate: w.StartDate })) };
    },
  };
}

/** One line for the job's Salesforce status: case status plus the latest work order and its date. */
export function statusLine(c: CaseInfo): string {
  const wo = c.workOrders[c.workOrders.length - 1];
  return [c.status, wo ? `WO ${wo.number} ${wo.status}${wo.startDate ? ` ${wo.startDate.slice(0, 10)}` : ''}` : null].filter(Boolean).join(' · ');
}
