import type { ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'gray';
export const Badge = ({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) => <span className={`badge b-${tone}`}>{children}</span>;

export function actionTone(action: string): Tone {
  switch (action) {
    case 'Needs Service': return 'bad';
    case 'Verify ID': return 'warn';
    case 'Investigate': case 'Requested by property': return 'warn';
    case 'Unrecognized': return 'info';
    default: return 'ok';
  }
}

export function warrantyTone(status: string): Tone {
  return status === 'Active' ? 'ok' : status === 'Expiring' ? 'warn' : status === 'Expired' ? 'bad' : 'gray';
}

export function Flash({ msg, error }: { msg?: string; error?: string }) {
  if (error) return <div className="flash error" role="alert">{error}</div>;
  if (msg) return <div className="flash ok" role="status">{msg}</div>;
  return null;
}

export const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));

/** Query-string helpers for redirects with a message. */
export const withMsg = (path: string, msg: string) => `${path}${path.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}`;
export const withError = (path: string, err: string) => `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(err)}`;

export type SP = Promise<{ [k: string]: string | string[] | undefined }>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Dates on screen in US format (11/13/2026), matching the PDFs. Accepts ISO dates or timestamps. */
export const us = (d: string | null | undefined) => { if (!d) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? `${m[2]}/${m[3]}/${m[1]}` : d; };
export const daysSince = (d: string, today: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(d)) / 86400000));
/** Timestamps from the database are UTC; show them in the office's time zone (APP_TIMEZONE, default US Central). */
const TZ = () => process.env.APP_TIMEZONE || 'America/Chicago';
export const localDate = (ts: string | null | undefined) => { if (!ts) return ''; const d = new Date(ts.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')); return Number.isNaN(d.getTime()) ? us(ts) : d.toLocaleDateString('en-US', { timeZone: TZ(), month: '2-digit', day: '2-digit', year: 'numeric' }); };
export const localTime = (ts: string | null | undefined) => { if (!ts) return ''; const d = new Date(ts.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')); return Number.isNaN(d.getTime()) ? ts : `${localDate(ts)} ${d.toLocaleTimeString('en-US', { timeZone: TZ(), hour: 'numeric', minute: '2-digit' })}`; };
