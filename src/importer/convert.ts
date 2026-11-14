// Value converters. Each takes one raw cell and either returns a value or says exactly why it could not.
// Blank cells are not errors here: whether a blank is allowed is the field's business (required / default).
import { Cell, str, num, bool, parseDate, parseTimestamp } from '../parsers/common';

export type FieldType = 'text' | 'label' | 'integer' | 'decimal' | 'percent' | 'date' | 'timestamp' | 'boolean' | 'service';
export type Converted = { ok: true; value: string | number | boolean | null } | { ok: false; error: string };

const fail = (error: string): Converted => ({ ok: false, error });
const ok = (value: string | number | boolean | null): Converted => ({ ok: true, value });

/** Excel day serial (1900 system) to ISO date. Only the plausible range is accepted. */
function serialDate(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

/** Service wording to the audit report's ServiceID. Unknown wording is an error, never a guess. */
export function serviceCode(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (['ws', 'gs', 'el'].includes(s)) return s.toUpperCase();
  if (/\bgas\b/.test(s)) return 'GS';
  if (/elec/.test(s)) return 'EL';
  if (/water|\bhw\b|\bcw\b|\bhot\b|\bcold\b/.test(s)) return 'WS';
  return null;
}

export function isBlank(v: Cell | undefined): boolean { return str(v) === null; }

export function convert(type: FieldType, raw: Cell | undefined): Converted {
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
      if (typeof raw === 'number') { const d = serialDate(raw); return d ? ok(d + 'T00:00:00.000Z') : fail(`"${s}" is not a date and time`); }
      const t = parseTimestamp(raw); return t ? ok(t) : fail(`"${s}" is not a date and time`);
    }
    case 'boolean': { const b = bool(raw); return b !== null ? ok(b) : fail(`"${s}" is not yes or no`); }
    case 'service': { const c = serviceCode(s); return c ? ok(c) : fail(`"${s}" is not a known service (water, gas, electric); map it by hand`); }
  }
}
