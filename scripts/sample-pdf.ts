// Writes sample client and technician PDFs from invented data.  npm run sample:pdf -- ./out
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderPdf } from '../src/documents/pdf';
import type { FrozenContent, FrozenLine } from '../src/documents/render';
const dir = process.argv[2] ?? 'sample-out'; mkdirSync(dir, { recursive: true });
const line = (i: number, o: Partial<FrozenLine> = {}): FrozenLine => ({ building: String(1 + (i % 3)), unit: String(101 + i), address: `1 SYNTHETIC WAY # ${101 + i}`, service: 'WS', issueCode: 'NT',
  description: 'Needs Service: No transmission. Replace transmitter.', component: 'transmitter', quantity: 1, unitPrice: 85, laborPrice: 85, laborCovered: false, partCovered: false, include: true, ...o });
const clauses = [
  { key: 'wa_intro', title: 'Why', body: 'As with any electronic system, parts can fail or a system can become inoperative. The Minol Meter Reading and Service Department has detected problems with your system in need of service.' },
  { key: 'wa_estimate', title: 'Estimate', body: 'Please find below an estimated cost of service. You will be billed for the actual work that needs to be done.', audience: 'client' as const },
  { key: 'quote_notice', title: 'Important notification', body: 'This statement is a quote for work to be completed and not an invoice. Work will be invoiced monthly as it is completed.', audience: 'client' as const },
  { key: 'wa_authorization', title: 'Owner service work authorization', body: 'Please initial one option below, sign and return to Minol via email at ServiceWA@minolusa.com.\nI authorize MINOL to provide a technician to evaluate and complete all necessary repairs.\nI DO NOT authorize Minol to complete repairs at this time.\nIf the technician cannot complete the work due to property issues then the property will be charged for all labor costs.', audience: 'client' as const },
  { key: 'resident_notice', title: 'Resident notice', body: 'This letter serves as a 48-hour notice that a representative from Minol will be accessing your apartment.\nIf you fail to allow access, repairs will not be completed.\nWe appreciate your cooperation.', audience: 'client' as const },
];
const wa: FrozenContent = { number: '262000000-261110', type: 'WA', actsAs: null, title: 'Building 1-3 water repairs', chargeCode: '23', version: 1, issuedOn: '2026-11-10', quoteValidUntil: '2026-12-10',
  property: { name: 'Synthetic Gardens', classId: '9900001', address: '1 Synthetic Way', city: 'Austin', state: 'TX', zip: '78704', accessNotes: 'Gate code 1234. Call the office first.', schedulingNotes: 'Weekdays 9-4' },
  systemNotes: { utilities: [{ utility: 'Water', device: 'MM FAM' }], systemBrand: 'Inovonics', systemId: 'TW.com YR6PH5TP', collectorLocation: 'Leasing office IT closet', milestoneKind: 'Takeover', milestoneOn: '2023-06-28', techNote: 'Please check all wiring and replace equipment as needed. Verify transmitting and incrementing prior to leaving each unit.', transmitterDevice: 'Inovonics Transmitter', meterDevice: null, equipment: [{ qty: 1, device: 'Programmer' }], bring: [{ qty: 22, device: 'Inovonics Transmitter' }, { qty: 1, device: 'Programmer' }] },
  siteContact: { name: 'Pat Example', phone: '(555) 010-0199', email: 'pat@example.test' }, salesforceCase: '500XYZ', salesforceWorkOrder: '08XYZ', clauses,
  lines: [...Array.from({ length: 22 }, (_, i) => line(i, i % 4 === 0 ? { laborCovered: true, partCovered: true } : {})),
    ...Array.from({ length: 5 }, (_, i) => line(30 + i, { issueCode: 'IDMM', description: 'Verify ID: ID mismatch.', unitPrice: null }))] };
const pr: FrozenContent = { number: '9900002-260914', type: 'Proposal', actsAs: null, title: null, version: 1, issuedOn: '2026-09-14', quoteValidUntil: '2026-10-14',
  property: { name: 'Synthetic Condos', classId: '9900002', address: '100 Example Ave S', city: 'Seattle', state: 'WA', zip: '98118', accessNotes: null, schedulingNotes: null },
  addressee: 'Jordan Sample\nExample Group, LLC\n200 Sample Blvd. STE 100\nSeattle, WA 98100\n(555) 010-0100\njordan@example.test', notes: 'Minol to provide (1) Gateway, pre-programmed. Property or their preferred agent to install Gateway. Permits as required are the sole responsibility of the property and their preferred agent.',
  shipping: 62, preparedBy: 'AJ', salesforceCase: null, salesforceWorkOrder: null,
  clauses: [{ key: 'quote_notice', title: 'Important notification', body: 'This statement is a quote for work to be completed and not an invoice.', audience: 'client' as const },
    { key: 'proposal_acceptance', title: 'Acceptance of proposal', body: 'Minol, Inc offers to sell the goods and services described above only upon the terms and conditions contained in this proposal.', audience: 'client' as const }],
  lines: [line(0, { building: null, unit: null, address: null, description: 'SpeedNet Gateway', unitPrice: 2100, laborPrice: null }), line(1, { building: null, unit: null, address: null, description: 'Remote Commissioning', unitPrice: 250, laborPrice: null })] };
for (const [n, c] of [['wa', wa], ['proposal', pr]] as const) {
  writeFileSync(`${dir}/${n}-client.pdf`, await renderPdf(c, 'client'));
  if (n === 'wa') writeFileSync(`${dir}/${n}-technician.pdf`, await renderPdf(c, 'tech'));
}
console.log(`wrote sample PDFs to ${dir}`);
