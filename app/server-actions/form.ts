// Shared by every server action: reading form values and telling the person's mistakes from bugs.
import { isUserError } from '@/src/errors';

/** A trimmed text field, or null when blank. */
export const s = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() !== '' ? v.trim() : null; };
/** A number field ($ and commas allowed), or null when blank or not a number. */
export const n = (fd: FormData, k: string): number | null => { const v = s(fd, k); if (v === null) return null; const x = Number(v.replace(/[$,]/g, '')); return Number.isFinite(x) ? x : null; };
/** A field that must be one of a fixed list; anything else is treated as not given. */
export const oneOf = <T extends string>(fd: FormData, k: string, allowed: readonly T[]): T | null => { const v = s(fd, k); return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : null; };
export const msgOf = (e: unknown) => (isUserError(e) ? e.message : 'Something went wrong.');
/** Next.js signals a redirect by throwing; never swallow it. */
export const isRedirect = (e: unknown) => typeof e === 'object' && e !== null && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT');
/** A problem the person can fix (shown as is). Anything else is a bug: rethrown, logged by Next, shown as an error page. */
export const domainError = isUserError;
