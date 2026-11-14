// Plain-language wording for the client, from fixed phrase templates. No AI: the same inputs always give the same text,
// and a coordinator edits the result. Nothing here claims a unit is fixed beyond what the technician recorded.
// The labels and sentences are list wording (Admin > Lists); the built-in wording is in src/lists/lists.ts.
import type { Action, Result } from './record';
import { BUILTIN_LISTS, type Lists } from '../lists/lists';

/** The label for a result, or for the added result item that was picked. */
export const resultLabel = (result: Result, item?: string | null, lists: Lists = BUILTIN_LISTS) => lists.label('visit_result', item ?? result);
export const issueLabel = (code: string | null, lists: Lists = BUILTIN_LISTS) => (code ? lists.label('audit_code', code) : 'Inspection');

/** The result to assume when the technician did not pick one. */
export function defaultResult(action: Action, outcome: string): Result {
  if (outcome === 'unable_to_access') return 'unable_to_access';
  if (outcome === 'unable_to_complete') return 'unable_to_complete';
  return ({ replace: 'replaced', repair: 'repaired', reprogram: 'reprogrammed', inspect_test: 'no_fault_found', other: 'other' } as const)[action];
}

export interface PhraseInput { issueCode: string | null; result: Result; resultItem?: string | null; newTxId?: string | null; replacedKinds?: string[]; startRead?: number | null; endRead?: number | null }

/** Fixed sentences: the audit code's opening, then the result's sentence. {tx} and {part} are filled from the record; a missing value drops its clause. */
export function suggestComment(i: PhraseInput, lists: Lists = BUILTIN_LISTS): string {
  const part = [...new Set((i.replacedKinds ?? []).map((k) => lists.wording('part_kind', k) || k))].join(' and ') || 'equipment';
  const open = i.issueCode ? lists.wording('audit_code', i.issueCode) ?? '' : '';
  const tx = i.newTxId && (i.replacedKinds ?? []).some((k) => k !== 'meter') ? ` (new transmitter ID ${i.newTxId})` : '';
  const sentence = (i.resultItem ? lists.wording('visit_result', i.resultItem) : null) ?? lists.wording('visit_result', i.result) ?? '';
  const body = sentence.replace('{part}', part).replace('{tx}', tx);
  const reads = i.startRead != null && i.endRead != null ? ` Meter read ${i.startRead} before and ${i.endRead} after.` : '';
  return [open, body].filter(Boolean).join(' ') + (body ? reads : '');
}
