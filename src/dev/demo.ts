// A believable demo: three invented properties at different points in the service lifecycle.
// Everything is synthetic. Used by `npm run demo` and by tests.
import type { Db } from '../db';
import { importParsed } from '../import/commit';
import { parseAutoAudit } from '../parsers/audit';
import { parseCimNextCentury } from '../parsers/cim';
import { parsePsr } from '../parsers/psr';
import { auditLines, needsAction } from '../queries/audit';
import { createDocument, issueVersion } from '../documents/build';
import { recordVisit, type EventInput } from '../service/record';
import { approveCloseout, saveClientText, sendInvoiceSheet, closeoutData } from '../service/closeout';
import { buildIdUpdate, markExported } from '../service/idupdate';
import { createUser } from '../auth/auth';
import { synthUnits, synthAutoAudit, synthCim, synthPsr, type SynthOpts } from './synthetic';

export const DEMO_LOGIN = { email: 'demo@example.test', password: 'Demo-Pass-2026' };

interface Spec { classId: string; name: string; address: string; city: string; installedByUs: boolean; installedOn: string; billingContract: boolean; msa: boolean; seed: number }
const SPECS: Spec[] = [
  { classId: '9910001', name: 'Maple Ridge Apartments', address: '100 Maple Ridge Dr', city: 'Austin', installedByUs: true, installedOn: '2026-03-10', billingContract: true, msa: false, seed: 11 },
  { classId: '9910002', name: 'Harbor View Lofts', address: '200 Harbor View Rd', city: 'Tacoma', installedByUs: true, installedOn: '2024-02-01', billingContract: false, msa: false, seed: 23 },
  { classId: '9910003', name: 'Cedar Court', address: '300 Cedar Ct', city: 'Denver', installedByUs: false, installedOn: '2025-05-01', billingContract: true, msa: true, seed: 37 },
];

async function setupProperty(db: Db, s: Spec) {
  const units = synthUnits(3, 8, s.seed);
  const o: SynthOpts = { classId: s.classId, name: s.name };
  const pid = (await db.query<{ id: string }>(
    `INSERT INTO property (class_id,name,address,city,state,zip,installed_by_us,billing_contract,msa) VALUES ($1,$2,$3,$4,'TX','78701',$5,$6,$7) RETURNING id`,
    [s.classId, s.name, s.address, s.city, s.installedByUs, s.billingContract, s.msa])).rows[0].id;
  await db.query(`INSERT INTO contact (property_id,name,phone,email,is_primary) VALUES ($1,'Pat Manager','555-0100','manager@example.test',true)`, [pid]);
  if (s.installedByUs) await importParsed(db, pid, parsePsr(synthPsr(units, o)), { createMissing: true });
  await db.query(`UPDATE property SET install_completed_on=$2 WHERE id=$1 AND installed_by_us`, [pid, s.installedOn]);
  const audit = await importParsed(db, pid, parseAutoAudit(synthAutoAudit(units, o)), { createMissing: true });
  // Cedar Court: a few transmitters that still read but report low battery (preventative maintenance).
  const healthy = units.filter((u) => u.code === 'OK').slice(0, 3).map((u) => u.unit);
  await importParsed(db, pid, parseCimNextCentury(synthCim(units, s.msa ? { ...o, lowBattery: healthy } : o)));
  return { pid, units, o, audit };
}

const ev = (endpointId: string, code: string, replace?: string): EventInput => replace
  ? { endpointId, action: 'replace', issueCode: code, readAtService: 1000, endRead: 1002, notes: 'Replaced transmitter; unit now reading.', replacements: [{ kind: 'transmitter', newHardwareId: replace }] }
  : { endpointId, action: 'inspect_test', issueCode: code, notes: 'Inspected and tested on site.' };

export async function buildDemo(db: Db): Promise<{ properties: number }> {
  await createUser(db, { email: DEMO_LOGIN.email, name: 'Demo Admin', role: 'admin', password: DEMO_LOGIN.password, mustChangePassword: false });
  for (const s of SPECS) {
    const p = await setupProperty(db, s);
    // The three scenarios below run per property.
    const lines = needsAction(await auditLines(db, p.audit.batchId!, '2026-11-13')).filter((l) => ['NT', 'NI', 'INT', 'IDMM'].includes(l.code));
    const units = lines.slice(0, 4);
    if (s.classId === '9910001') {
      // Fully worked: WA, completed visit, approved notes, invoiced, ID update sent; a later audit confirms one fix and shows one still failing.
      const wa = await createDocument(db, { propertyId: p.pid, type: 'WA', title: 'Meter system repairs', createdOn: '2026-11-02', fromAuditBatch: p.audit.batchId!, salesforceCase: '00812345' });
      await issueVersion(db, wa.versionId, null, '2026-11-02');
      const a = units[0], b = units[1];
      if (a && b) {
        const v = await recordVisit(db, { propertyId: p.pid, visitedOn: '2026-11-05', technician: 'Casey Tech', outcome: 'completed', salesforceCase: '00812345', salesforceWorkOrder: '00045678', documentId: wa.documentId,
          events: [ev(a.endpointId, a.code, 'MR-NEW-0001'), ev(b.endpointId, b.code, 'MR-NEW-0002'), ...(units[2] ? [ev(units[2].endpointId, units[2].code)] : [])] });
        await approveCloseout(db, v.visitId, null);
        await sendInvoiceSheet(db, v.visitId, null, '2026-11-06', 'ADM-2026-114');
        await buildIdUpdate(db, v.visitId); await markExported(db, v.visitId);
        // Later audit window (after the visit): first replaced unit healthy with its new ID, second still not transmitting.
        const o2: SynthOpts = { ...p.o, d1: '11/06/2026', d2: '11/12/2026', override: { [a.unit]: { code: 'OK', tx: 'MR-NEW-0001' }, [b.unit]: { code: 'NT', tx: 'MR-NEW-0002' } } };
        await importParsed(db, p.pid, parseAutoAudit(synthAutoAudit(p.units, o2)), { createMissing: true });
      }
    } else if (s.classId === '9910002') {
      // Out-of-warranty, no billing contract: visit recorded, client notes waiting for approval.
      if (units.length >= 2) {
        const v = await recordVisit(db, { propertyId: p.pid, visitedOn: '2026-11-10', technician: 'Casey Tech', outcome: 'completed', salesforceCase: '00812999',
          events: [ev(units[0].endpointId, units[0].code, 'HV-NEW-0001'), ev(units[1].endpointId, units[1].code)] });
        await saveClientText(db, v.visitId, [], 'Service was completed on the units listed below.', null);
      }
    } else {
      // MSA property: approved notes, not yet invoiced, ID update built but not sent; plus a draft Proposal.
      if (units.length >= 2) {
        const v = await recordVisit(db, { propertyId: p.pid, visitedOn: '2026-11-11', technician: 'Jordan Tech', outcome: 'completed',
          events: [ev(units[0].endpointId, units[0].code, 'CC-NEW-0001'), ev(units[1].endpointId, units[1].code)] });
        const c = await closeoutData(db, v.visitId);
        await saveClientText(db, v.visitId, c.units.map((u) => ({ eventId: u.eventId, clientComment: null, extraComment: null })), 'Thank you for your patience while we completed this work.', null);
        await approveCloseout(db, v.visitId, null);
        await buildIdUpdate(db, v.visitId);
      }
      await createDocument(db, { propertyId: p.pid, type: 'Proposal', title: 'Transmitter replacement', createdOn: '2026-11-12', fromAuditBatch: p.audit.batchId! });
    }
  }
  return { properties: SPECS.length };
}
