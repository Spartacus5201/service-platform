// Every numeric setting with its default, in one table. Code reads settings only through here, so a default is
// written once and a missing or unreadable value always falls back the same way.
import type { Db, Q } from './db';


export const SETTING_DEFAULTS = {
  int_read_threshold: 5,            // INT: an automated read count at or below this is a candidate
  int_stale_days: 3,                // INT: ...if the last real read is at least this many days before the audit ends
  warranty_months_install: 12,
  warranty_months_service: 12,
  expiring_window_days: 30,
  quote_valid_days: 30,
  labor_rate: 85,
  post_audit_days: 7,
  audit_interval_days: 0,           // 0 = not set: no "next audit due" dates
  pm_battery_threshold: 25,
  pm_wa_threshold: 1,
  pm_battery_price: 9.1,
  raw_import_retention_days: 180,
} as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = { [K in SettingKey]: number };

/** All numeric settings, defaults filled in. */
export async function readSettings(q: Q): Promise<Settings> {
  const rows = (await q.query<{ key: string; value: unknown }>(`SELECT key, value FROM setting WHERE key = ANY($1)`, [Object.keys(SETTING_DEFAULTS)])).rows;
  const out = { ...SETTING_DEFAULTS } as Settings;
  for (const r of rows) { const n = Number(r.value); if (r.value !== null && Number.isFinite(n)) out[r.key as SettingKey] = n; }
  return out;
}

export async function setting(q: Q, key: SettingKey): Promise<number> { return (await readSettings(q))[key]; }
