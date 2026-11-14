// Code review group B (docs/REVIEW-2026-11.md): imports and status.
import { describe, it, expect } from 'vitest';
import { world, count } from './helpers';
import { parseFile, ParseError, parseTimestamp } from '../src/parsers';
import { parsePsr } from '../src/parsers/psr';
import { psrSheets } from './fixtures';
import { importParsed } from '../src/import/commit';
import { openIssues } from '../src/import/issues';
import { recordVisit } from '../src/service/record';
import { verifyVisit, followUps } from '../src/service/verify';
import { stagedLines } from '../src/service/unitstatus';
import { auditLines } from '../src/queries/audit';
import { setOverride } from '../src/review/overrides';
import { DEFAULT_SERVICES } from '../src/lists/services';
import { synthAmrStatus, synthUnits } from '../src/dev/synthetic';
import { createUpload, wizardView, saveState, chooseTarget, commitWizard } from '../src/importer/wizard';
import { convert } from '../src/importer/convert';
import type { CimParse } from '../src/parsers/cim';

const enc = (t: string) => new TextEncoder().encode(t);

describe('review B: imports', () => {
  it('B1: an AMR Status upload with an unknown utility stops for the wizard; a word added to the service list is read', async () => {
    const odd = synthAmrStatus(synthUnits(1, 3)).replace('All Water', 'Irrigation');
    const e = await parseFile(enc(odd)).catch((x) => x);
    expect(e).toBeInstanceOf(ParseError); expect(e.code).toBe('needs_wizard');
    const services = DEFAULT_SERVICES.map((s) => (s.code === 'WS' ? { ...s, words: [...s.words, 'irrigation'] } : s));
    const p = (await parseFile(enc(odd), { services })) as CimParse;
    expect(p.devices.every((d) => d.serviceCode === 'WS')).toBe(true);
  });

  it('B1: a CIM row with an unknown utility is reported and left out, never filed as water', async () => {
    const { parseCimInovonics } = await import('../src/parsers/cim');
    const { cimInovGrid } = await import('./fixtures');
    const g = cimInovGrid(); g[3][7] = 'Irrigation';
    const p = parseCimInovonics(g);
    expect(p.devices.map((d) => d.serviceCode)).toEqual(['GS']);
    expect(p.warnings.join(' ')).toMatch(/Irrigation.*not on the service list/);
  });

  it('B2: a transmitter ID on record at another unit is not installed twice; it becomes an import problem', async () => {
    const { db, pid } = await world();
    // AMR1 is unit 102's transmitter. A status report says unit 103 hot water has AMR1.
    const csv = 'Building,Unit,Utility Type,Serial Number,Meter Id,Model,Battery Level,Last Check In,Meter Type,Meter Read,Meter Usage\n1,103,Hot Water,AMR1,103,TR4,90%,2026-11-12T08:00:00-05:00,Poly,1,1\n';
    const r = await importParsed(db, pid, (await parseFile(enc(csv))) as CimParse, { createMissing: true });
    expect(r.idElsewhere).toEqual([expect.objectContaining({ unit: '103', hardwareId: 'AMR1', at: '1-102 WS' })]);
    expect(await count(db, `SELECT count(*) n FROM installation i JOIN device d ON d.id=i.device_id WHERE d.hardware_id='AMR1' AND i.removed_on IS NULL`)).toBe(1);
    expect((await openIssues(db, pid)).filter((i) => i.kind === 'id_elsewhere')).toHaveLength(1);
  }, 60000);

  it('B3: check-in times are read exactly or not at all', () => {
    expect(parseTimestamp('11/12/2026 3:45:12 PM')).toBe('2026-11-12T15:45:12.000Z');
    expect(parseTimestamp('11/12/2026 08:00:00 CST')).toBe('2026-11-12T14:00:00.000Z');
    expect(parseTimestamp('2026-11-12T08:00:00.123-05:00')).toBe('2026-11-12T13:00:00.123Z');
    expect(parseTimestamp('11/12/2026 08:00:00 Mars Time')).toBeNull();
    expect(parseTimestamp('11/12/2026 13:00 PM')).toBeNull();
    expect(convert('timestamp', 46338.75)).toEqual({ ok: true, value: '2026-11-12T18:00:00.000Z' });
    expect(convert('date', 46338.75)).toEqual({ ok: true, value: '2026-11-12' });
  });

  it('B5: if the map cannot be saved, nothing is imported', async () => {
    const { db, pid } = await world();
    const file = enc('Apt,Bldg,Radio,Utility\n101,1,AMR0,Water\n');
    const up = await createUpload(db, pid, 'a.csv', file, null);
    const v = await wizardView(db, up.id);
    const st = chooseTarget(v.state, v.columns.map((c) => c.header), { target: 'devices' });
    await saveState(db, up.id, { ...st, suggested: false, overrides: { ...st.overrides, columns: { ...st.overrides.columns, hardware_id: 3 } } });
    const before = await count(db, `SELECT count(*) n FROM import_batch`);
    // Make the save fail inside the transaction (a clash on the map's key).
    await db.query(`CREATE FUNCTION fail_layout() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'duplicate key value violates unique constraint "import_layout_pkey"'; END $$ LANGUAGE plpgsql`);
    await db.query(`CREATE TRIGGER t BEFORE INSERT ON import_layout FOR EACH ROW EXECUTE FUNCTION fail_layout()`);
    await expect(commitWizard(db, up.id, { saveAs: 'Acme', userId: null })).rejects.toThrow(/Nothing was imported/);
    expect(await count(db, `SELECT count(*) n FROM import_batch`)).toBe(before);
  }, 60000);

  it('B6: a damaged PSR says what is wrong instead of opening the wizard', async () => {
    const sheets = psrSheets(); sheets[0].rows = sheets[0].rows.map((r) => r.map((c) => (c === 'Bldg #' ? 'x' : c)));
    const e = (() => { try { parsePsr(sheets); } catch (x) { return x as ParseError; } })();
    expect(e?.code).toBe('unreadable');
  });

  it('B7: an ID mismatch problem keeps its service', async () => {
    const { db, pid } = await world();
    const csv = 'Building,Unit,Utility Type,Serial Number,Meter Id,Model,Battery Level,Last Check In,Meter Type,Meter Read,Meter Usage\n1,102,All Water,NEWID,102,TR4,90%,2026-11-12T08:00:00-05:00,Poly,1,1\n';
    await importParsed(db, pid, (await parseFile(enc(csv))) as CimParse);
    expect((await openIssues(db, pid)).find((i) => i.kind === 'id_mismatch')?.service).toBe('WS');
  }, 60000);
});

describe('review B: one answer for "still failing"', () => {
  it('B4: a reviewer\'s "No action" on the later audit counts as fixed everywhere', async () => {
    const { db, pid, batchId, ep } = await world();
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-09-15', outcome: 'completed', events: [{ endpointId: await ep('102'), action: 'repair', issueCode: 'NT' }] });
    expect((await verifyVisit(db, v.visitId))[0].status).toBe('failed');
    expect(await followUps(db, pid)).toHaveLength(1);
    expect((await stagedLines(db, batchId, '2026-11-13')).find((l) => l.unit.endsWith('102'))?.stage).toBe('not_fixed');
    const line = (await auditLines(db, batchId, '2026-11-13')).find((l) => l.unit.endsWith('102'))!;
    await setOverride(db, line.readingId, { action: 'No action', reason: 'Reading checked on site' }, null, line.rules);
    expect((await verifyVisit(db, v.visitId))[0]).toMatchObject({ status: 'verified' });
    expect(await followUps(db, pid)).toHaveLength(0);
    expect((await stagedLines(db, batchId, '2026-11-13')).find((l) => l.unit.endsWith('102'))).toBeUndefined();
  }, 60000);

  it('B4: a usage flag after a repair is a new item, not a failed repair', async () => {
    const { db, pid, batchId, ep } = await world();
    const v = await recordVisit(db, { propertyId: pid, visitedOn: '2026-09-15', outcome: 'completed', events: [{ endpointId: await ep('104'), action: 'repair', issueCode: 'NT' }] });
    expect((await verifyVisit(db, v.visitId))[0].status).toBe('pending');           // 104 now reports HIGH: investigate
    expect((await stagedLines(db, batchId, '2026-11-13')).find((l) => l.unit.endsWith('104'))?.stage).toBe('needs_document');
  }, 60000);
});
