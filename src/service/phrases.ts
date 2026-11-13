// Plain-language wording for the client, from fixed phrase templates. No AI: the same inputs always give the same text,
// and a coordinator edits the result. Nothing here claims a unit is fixed beyond what the technician recorded.
import type { Action, Result } from './record';

export const RESULT_LABEL: Record<Result, string> = {
  repaired: 'Repaired', replaced: 'Replaced', reprogrammed: 'Reprogrammed', no_fault_found: 'No fault found',
  unable_to_access: 'Unable to access', unable_to_complete: 'Unable to complete', other: 'Other',
};

export const ISSUE_LABEL: Record<string, string> = {
  NI: 'No usage recorded', NT: 'Not transmitting', INT: 'Intermittent transmission', IDMM: 'Device ID mismatch',
  HIGH: 'High usage', LOW: 'Low usage', NEG: 'Negative usage', OTHER: 'Other',
};
export const issueLabel = (code: string | null) => (code ? ISSUE_LABEL[code.toUpperCase()] ?? code : 'Inspection');

/** The result to assume when the technician did not pick one. */
export function defaultResult(action: Action, outcome: string): Result {
  if (outcome === 'unable_to_access') return 'unable_to_access';
  if (outcome === 'unable_to_complete') return 'unable_to_complete';
  return ({ replace: 'replaced', repair: 'repaired', reprogram: 'reprogrammed', inspect_test: 'no_fault_found', other: 'other' } as const)[action];
}

export interface PhraseInput { issueCode: string | null; result: Result; newTxId?: string | null; replacedKinds?: string[]; startRead?: number | null; endRead?: number | null }

const KIND_WORD: Record<string, string> = { transmitter: 'transmitter', meter: 'meter', combo: 'meter and transmitter' };
const part = (i: PhraseInput) => {
  const ks = [...new Set((i.replacedKinds ?? []).map((k) => KIND_WORD[k] ?? k))];
  return ks.length ? ks.join(' and ') : 'equipment';
};

/** Fixed sentences, chosen by issue then result. {tx} and {part} are filled from the record; a missing value drops its clause. */
const ISSUE_OPEN: Record<string, string> = {
  NT: 'The transmitter was not sending readings.',
  NI: 'The meter was not recording any usage.',
  INT: 'Readings from this unit were arriving only occasionally.',
  IDMM: 'The device ID on file did not match the device installed.',
  HIGH: 'Usage on this unit was higher than expected.',
  LOW: 'Usage on this unit was lower than expected.',
  NEG: 'Usage on this unit was reported as negative.',
};
const RESULT_TEXT: Record<Result, string> = {
  replaced: 'We replaced the {part}{tx}. The unit should report normally on the next read cycle.',
  repaired: 'We repaired the {part} on site. The unit should report normally on the next read cycle.',
  reprogrammed: 'We reprogrammed the device and confirmed the setup. The unit should report normally on the next read cycle.',
  no_fault_found: 'We inspected and tested the equipment and found no fault.',
  unable_to_access: 'We could not get access to the unit. It will need to be rescheduled.',
  unable_to_complete: 'We could not complete the work on this visit. A follow-up visit will be scheduled.',
  other: '',
};

export function suggestComment(i: PhraseInput): string {
  const open = i.issueCode ? ISSUE_OPEN[i.issueCode.toUpperCase()] ?? '' : '';
  const tx = i.newTxId && (i.replacedKinds ?? []).some((k) => k !== 'meter') ? ` (new transmitter ID ${i.newTxId})` : '';
  const body = RESULT_TEXT[i.result].replace('{part}', part(i)).replace('{tx}', tx);
  const reads = i.startRead != null && i.endRead != null ? ` Meter read ${i.startRead} before and ${i.endRead} after.` : '';
  return [open, body].filter(Boolean).join(' ') + (body ? reads : '');
}
