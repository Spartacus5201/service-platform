// Value converters. Each takes one raw cell and either returns a value or says exactly why it could not.
// Blank cells are not errors here: whether a blank is allowed is the field's business (required / default).
import { Cell, str, num, bool, parseDate, parseTimestamp } from '../parsers/common';
import { DEFAULT_SERVICES, matchService, type ServiceType } from '../lists/services';

export type FieldType = 'text' | 'label' | 'integer' | 'decimal' | 'percent' | 'date' | 'timestamp' | 'boolean' | 'service';
export type Converted = { ok: true; value: string | number | boolean | null } | { ok: false; error: string };

const fail = (error: string): Converted => ({ ok: false, error });
const ok = (value: string | number | boolean | null): Converted => ({ ok: true, value });

/** Excel day serial (1900 system) to ISO date: the whole days (the fraction is the time of day). Plausible range only. */
function serialDate(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}
/** Excel serial with time of day to an ISO timestamp (read as UTC, like a report time with no zone). */
function serialTimestamp(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400) * 1000).toISOString();
}

/** Service wording to the audit report's ServiceID, from the service list. Unknown wording is an error, never a guess. */
export function serviceCode(v: string, services: ServiceType[] = DEFAULT_SERVICES): string | null { return matchService(v, services); }

/** What a conversion may look up: the service list (from the database in the app, the built-in list otherwise). */
export interface ConvertContext { services: ServiceType[] }

export function isBlank(v: Cell | undefined): boolean { return str(v) === null; }

export function convert(type: FieldType, raw: Cell | undefined, ctx?: ConvertContext): Converted {
  if (isBlank(raw)) return ok(null);
  const s = str(raw)!;
  switch (type) {
    case 'text': case 'label': return ok(s);
    case 'integer': { const n = num(raw); return n !== null && Number.isInteger(n) ? ok(n) : fail(`"${s}" is not a whole number`); }
    case 'decimal': { const n = num(raw); return n !== null ? ok(n) : fail(`"${s}" is not a number`); }
    case 'percent': {
      const n = typeof raw === 'number' ? raw : num(s.replace(/%\s*$/, ''));
      if (n === null) return fail(`"${s}" is not a percent`);
      if (n < 0 || n > 100) return fail(`${n}% is outside 0 to 100`);
      return ok(n);
    }
    case 'date': {
      const d = typeof raw === 'number' ? serialDate(raw) : parseDate(raw);
      return d ? ok(d) : fail(`"${s}" is not a date this importer reads (MM/DD/YY, MM/DD/YYYY or YYYY-MM-DD)`);
    }
    case 'timestamp': {
      if (typeof raw === 'number') { const t = serialTimestamp(raw); return t ? ok(t) : fail(`"${s}" is not a date and time`); }
      const t = parseTimestamp(raw); return t ? ok(t) : fail(`"${s}" is not a date and time this importer reads for certain (e.g. an unknown time zone)`);
    }
    case 'boolean': { const b = bool(raw); return b !== null ? ok(b) : fail(`"${s}" is not yes or no`); }
    case 'service': {
      const list = ctx?.services ?? DEFAULT_SERVICES; const c = serviceCode(s, list);
      return c ? ok(c) : fail(`"${s}" is not a service code or name on the service list (${list.filter((x) => x.active).map((x) => x.code).join(', ')}); say how to read it`);
    }
  }
}
