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
