// Local-only: parse real report files and print counts (never names or addresses).
// Usage: npm run check:real -- <file.xlsx> [more files]
import { readFileSync } from 'node:fs';
import { readWorkbook, parseSheets, detectFormat } from '../src/parsers';

for (const path of process.argv.slice(2)) {
  const sheets = await readWorkbook(readFileSync(path));
  console.log(`\n${path.split('/').pop()}  (${sheets.length} tabs)`);
  for (const s of sheets) {
    const d = detectFormat([s]);
    if (!d) continue;
    try {
      const p = parseSheets([s]);
      if ('rows' in p && p.kind !== 'unit_directory') {
        const codes: Record<string, number> = {};
        p.rows.forEach((r) => (codes[r.auditResult] = (codes[r.auditResult] ?? 0) + 1));
        const occ = p.rows.filter((r) => r.occupancy).length;
        const vac = p.rows.filter((r) => r.occupancy?.vacant).length;
        const manual = p.rows.filter((r) => r.isManual).length;
        console.log(`  [${s.name}] ${p.kind}: ${p.rows.length} rows, codes ${JSON.stringify(codes)}, occupancy parsed ${occ}, vacant ${vac}, manual ${manual}, warnings ${p.warnings.length}`);
      } else if ('equipment' in p) {
        console.log(`  [${s.name}] psr (${p.sheet}): ${p.equipment.length} equipment, ${p.units.length} units, skipped ${p.skippedNoDate.length}, completed ${p.completedOn}`);
      } else if ('devices' in p) {
        const bad = p.devices.filter((d) => !d.lastCheckIn).length;
        console.log(`  [${s.name}] ${p.kind}: ${p.repeaters.length} repeaters, ${p.devices.length} devices, no check-in ${bad}, summary ${p.totalEndpoints}/${p.reportingIn}/${p.nonAdvancing}`);
      }
    } catch (e) {
      console.log(`  [${s.name}] ${d.kind}: PARSE ERROR ${(e as Error).message}`);
    }
  }
}
