// Score the program against every golden case under corpus/ (or one folder).  npm run corpus [-- corpus/some-case]
import { caseDirs, evalCase } from '../src/eval/corpus';

const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const dirs = arg ? [arg] : caseDirs('corpus');
if (!dirs.length) { console.log('No cases found. See corpus/README.md.'); process.exit(0); }
let exact = 0, total = 0; const byBrand = new Map<string, [number, number]>();
for (const d of dirs) {
  const r = await evalCase(d);
  exact += r.exact; total += r.total;
  const b = byBrand.get(r.brand || '(unlabeled)') ?? [0, 0]; byBrand.set(r.brand || '(unlabeled)', [b[0] + r.exact, b[1] + r.total]);
  console.log(`${(100 * r.exact / r.total).toFixed(1).padStart(5)}%  ${r.name}  ${r.exact}/${r.total} rows match, ${r.actionable} need action, ${r.mismatches.length} differ`);
  for (const m of r.mismatches.slice(0, 40)) {
    const e = m.expected ? `${m.expected.action}${m.expected.owner ? ` (${m.expected.owner})` : ''}` : 'No action', a = m.actual ? `${m.actual.action}${m.actual.owner ? ` (${m.actual.owner})` : ''}` : 'absent';
    console.log(`        ${m.kind.padEnd(9)} ${m.key.replace(/\|/g, ' ')}${m.code ? `  code ${m.code}` : ''}: expected ${e}, got ${a}`);
  }
  if (r.mismatches.length > 40) console.log(`        … ${r.mismatches.length - 40} more`);
}
console.log(`\nOverall ${(100 * exact / total).toFixed(1)}%  (${exact}/${total})`);
for (const [b, [x, t]] of byBrand) console.log(`  ${b}: ${(100 * x / t).toFixed(1)}%  (${x}/${t})`);
