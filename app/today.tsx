import type { ReactNode } from 'react';
import { LIMITS, queueTotal, type Queues } from '@/src/queries/today';
import { Badge, us } from './ui';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const Age = ({ d, limit }: { d: number; limit?: number }) => <Badge tone={limit !== undefined && d >= limit ? 'warn' : 'gray'}>{d === 0 ? 'today' : `${d}d`}</Badge>;

function Queue({ title, hint, children, n }: { title: string; hint: string; n: number; children: ReactNode }) {
  if (!n) return null;
  return (<div className="queue"><h3>{title} <span className="small">({n})</span></h3><p className="small" style={{ marginTop: 0 }}>{hint}</p><ul>{children}</ul></div>);
}

export function Today({ q }: { q: Queues }) {
  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <h2 style={{ marginTop: 0 }}>Today</h2>
      {!queueTotal(q) && <p className="small">Nothing is waiting on anyone.</p>}
      <Queue title="Units with no WA yet" hint="Flagged by the latest audit and not on any WA, Proposal or RFM." n={q.needsDocument.length}>
        {q.needsDocument.map((x) => <li key={x.batchId}><a href={`/properties/${x.propertyId}/audits/${x.batchId}`}>{x.property}</a>: {plural(x.count, 'unit')} (audit {us(x.auditedOn)}) <Age d={x.days} /></li>)}
      </Queue>
      <Queue title="Import problems to resolve" hint="Units not on file and transmitter IDs that differ from our record." n={q.importIssues.length}>
        {q.importIssues.map((x) => <li key={x.propertyId}><a href={`/properties/${x.propertyId}?tab=audits#import-problems`}>{x.property}</a>: {plural(x.count, 'problem')} <Age d={x.days} /></li>)}
      </Queue>
      <Queue title="Revisit needed" hint="The technician could not get access or could not finish." n={q.revisit.length}>
        {q.revisit.map((x, i) => <li key={i}><a href={`/visits/${x.visitId}`}>{x.property}</a>: {x.unit} {x.service} ({x.result.replaceAll('_', ' ')}) <Age d={x.days} /></li>)}
      </Queue>
      <Queue title="Still failing after service" hint="An audit taken after the visit still flags the unit." n={q.failed.length}>
        {q.failed.map((x, i) => <li key={i}><a href={`/visits/${x.visitId}`}>{x.property}</a>: {x.unit} {x.service}: {x.evidence} <Age d={x.days} /></li>)}
      </Queue>
      <Queue title="Post-service audit due" hint="The audit after these visits has not been imported yet. Import it to see whether the work held." n={q.postAudit.length}>
        {q.postAudit.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}`}>{x.property}</a>: visit {us(x.visitedOn)}, {plural(x.waiting, 'unit')} awaiting audit, due {us(x.dueOn)} <Age d={x.days} limit={7} /></li>)}
      </Queue>
      <Queue title="Issued documents with units not yet serviced" hint="No visit recorded for these units since the document." n={q.notVisited.length}>
        {q.notVisited.map((x) => <li key={x.documentId}><a href={`/documents/${x.documentId}`}>{x.property} {x.number}</a>: {plural(x.units, 'unit')} <Age d={x.days} limit={LIMITS.docVisit} /></li>)}
      </Queue>
      <Queue title="Low battery transmitters (preventative maintenance)" hint="Still reading, but the battery is reported low. Quote them before they stop transmitting." n={q.lowBattery.length}>
        {q.lowBattery.map((x) => <li key={x.propertyId}><a href={`/properties/${x.propertyId}/battery`}>{x.property}</a>: {plural(x.count, 'transmitter')}, oldest since {us(x.oldest)} <Age d={x.days} /></li>)}
      </Queue>
      <Queue title="Service notes waiting for approval" hint="Review the client wording and approve." n={q.draftNotes.length}>
        {q.draftNotes.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}`}>{x.property}</a>: visit {us(x.visitedOn)}, {plural(x.units, 'unit')} <Age d={x.days} limit={LIMITS.notesApproval} /></li>)}
      </Queue>
      <Queue title="Approved, not yet sent for invoicing" hint="Send the invoicing sheet to admin." n={q.uninvoiced.length}>
        {q.uninvoiced.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}`}>{x.property}</a>: visit {us(x.visitedOn)}, {plural(x.units, 'unit')} <Age d={x.days} /></li>)}
      </Queue>
      <Queue title="Sent for invoicing, no invoice number yet" hint="Record the admin's invoice number when it comes back." n={q.invoiceNoRef.length}>
        {q.invoiceNoRef.map((x, i) => <li key={i}>{x.visitId ? <a href={`/visits/${x.visitId}`}>{x.property}</a> : x.property}: sent {us(x.submittedOn)} <Age d={x.days} limit={LIMITS.invoiceRef} /></li>)}
      </Queue>
      <Queue title="ID updates not yet sent" hint="Download the ID update workbook and send it to billing." n={q.idUpdates.length}>
        {q.idUpdates.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}/ids`}>{x.property}</a>: visit {us(x.visitedOn)}, {plural(x.rows, 'change')} <Age d={x.days} /></li>)}
      </Queue>
      <Queue title={`ID updates sent, not confirmed after ${LIMITS.idConfirm} days`} hint="No audit or check-in shows the new ID yet. Check with billing." n={q.idUnconfirmed.length}>
        {q.idUnconfirmed.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}/ids`}>{x.property}</a>: visit {us(x.visitedOn)}, {plural(x.rows, 'change')} <Age d={x.days} limit={LIMITS.idConfirm} /></li>)}
      </Queue>
      <Queue title="Jobs ready to close" hint="Serviced, invoiced, verified and IDs confirmed." n={q.readyToClose.length}>
        {q.readyToClose.map((x) => <li key={x.jobId}><a href={`/jobs/${x.jobId}`}>{x.property} #{x.number} {x.title}</a> <Age d={x.days} /></li>)}
      </Queue>
      <Queue title={`Drafts older than ${LIMITS.staleDraft} days`} hint="Issue them or delete them." n={q.staleDrafts.length}>
        {q.staleDrafts.map((x) => <li key={x.documentId}><a href={`/documents/${x.documentId}`}>{x.property} {x.type} {x.number}</a> <Age d={x.days} limit={LIMITS.staleDraft} /></li>)}
      </Queue>
    </section>
  );
}
