import { describe, it, expect } from 'vitest';
import { caseDirs, evalCase, parseCsv } from '../src/eval/corpus';

describe('golden corpus', () => {
  it('parses quoted CSV', () => { expect(parseCsv('a,"b,c"\n1,2\n')).toEqual([['a', 'b,c'], ['1', '2']]); });
  // Real cases (corpus/real-*) are measurements, run with `npm run corpus`; only the committed synthetic cases gate the build.
  for (const dir of caseDirs('corpus').filter((d) => !/[\/]real-/.test(d))) {
    it(`${dir} matches its signed-off audit`, async () => {
      const r = await evalCase(dir);
      expect(r.mismatches.map((m) => `${m.kind} ${m.key}`)).toEqual([]);
    }, 60000);
  }
});
