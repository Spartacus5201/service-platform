import type { ReactNode } from 'react';
import { LIMITS, type QueueKey, type Queues } from '@/src/queries/today';
import { Badge, us } from './ui';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const Age = ({ d, limit }: { d: number; limit?: number }) => <Badge tone={limit !== undefined && d >= limit ? 'warn' : 'gray'}>{d === 0 ? 'today' : `${d}d`}</Badge>;

function Queue({ title, hint, children, n }: { title: string; hint: string; n: number; children: ReactNode }) {
  if (!n) return null;
  return (<div className="queue"><h3>{title} <span className="small">({n})</span></h3><p className="small" style={{ marginTop: 0 }}>{hint}</p><ul>{children}</ul></div>);
}

/** One renderer per queue. The order on screen comes from `queuesFor` (the person's roles), not from here. */
const QUEUES: Record<QueueKey, (q: Queues) => ReactNode> = {
  myRevisits: (q) => <Queue title="Your revisits" hint="Units from your visits that need going back to." n={q.myRevisits.length}>
    {q.myRevisits.map((x, i) => <li key={i}><a href={`/visits/${x.visitId}`}>{x.property}</a>: {x.unit} {x.service} ({x.result.replaceAll('_', ' ')}) <Age d={x.days} /></li>)}
  </Queue>,
  myVisits: (q) => <Queue title="Your recent visits" hint="The last 60 days, and how the work is holding." n={q.myVisits.length}>
    {q.myVisits.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}`}>{x.property}</a>: {us(x.visitedOn)}, {plural(x.units, 'unit')}
      {x.fixed > 0 && <> · {x.fixed} fixed</>}{x.failing > 0 && <> · <Badge tone="warn">{x.failing} still failing</Badge></>}{x.revisit > 0 && <> · {x.revisit} revisit</>}{x.waiting > 0 && <> · {x.waiting} awaiting audit</>} <Age d={x.days} /></li>)}
  </Queue>,
  needsDocument: (q) => <Queue title="Units with no WA yet" hint="Flagged by the latest audit and not on any WA, Proposal or RFM." n={q.needsDocument.length}>
    {q.needsDocument.map((x) => <li key={x.batchId}><a href={`/properties/${x.propertyId}/audits/${x.batchId}`}>{x.property}</a>: {plural(x.count, 'unit')} (audit {us(x.auditedOn)}) <Age d={x.days} /></li>)}
  </Queue>,
  importIssues: (q) => <Queue title="Import problems to resolve" hint="Units not on file and transmitter IDs that differ from our record." n={q.importIssues.length}>
    {q.importIssues.map((x) => <li key={x.propertyId}><a href={`/properties/${x.propertyId}?tab=audits#import-problems`}>{x.property}</a>: {plural(x.count, 'problem')} <Age d={x.days} /></li>)}
  </Queue>,
  revisit: (q) => <Queue title="Revisit needed" hint="The technician could not get access or could not finish." n={q.revisit.length}>
    {q.revisit.map((x, i) => <li key={i}><a href={`/visits/${x.visitId}`}>{x.property}</a>: {x.unit} {x.service} ({x.result.replaceAll('_', ' ')}) <Age d={x.days} /></li>)}
  </Queue>,
  failed: (q) => <Queue title="Still failing after service" hint="An audit taken after the visit still flags the unit." n={q.failed.length}>
    {q.failed.map((x, i) => <li key={i}><a href={`/visits/${x.visitId}`}>{x.property}</a>: {x.unit} {x.service}: {x.evidence} <Age d={x.days} /></li>)}
  </Queue>,
  postAudit: (q) => <Queue title="Post-service audit due" hint="The audit after these visits has not been imported yet. Import it to see whether the work held." n={q.postAudit.length}>
    {q.postAudit.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}`}>{x.property}</a>: visit {us(x.visitedOn)}, {plural(x.waiting, 'unit')} awaiting audit, due {us(x.dueOn)} <Age d={x.days} limit={7} /></li>)}
  </Queue>,
  notVisited: (q) => <Queue title="Issued documents with units not yet serviced" hint="No visit recorded for these units since the document." n={q.notVisited.length}>
    {q.notVisited.map((x) => <li key={x.documentId}><a href={`/documents/${x.documentId}`}>{x.property} {x.number}</a>: {plural(x.units, 'unit')} <Age d={x.days} limit={LIMITS.docVisit} /></li>)}
  </Queue>,
  lowBattery: (q) => <Queue title="Low battery transmitters (preventative maintenance)" hint="Still reading, but the battery is reported low. Quote them before they stop transmitting." n={q.lowBattery.length}>
    {q.lowBattery.map((x) => <li key={x.propertyId}><a href={`/properties/${x.propertyId}/battery`}>{x.property}</a>: {plural(x.count, 'transmitter')}, oldest since {us(x.oldest)} <Age d={x.days} /></li>)}
  </Queue>,
  draftNotes: (q) => <Queue title="Service notes waiting for approval" hint="Review the client wording and approve." n={q.draftNotes.length}>
    {q.draftNotes.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}`}>{x.property}</a>: visit {us(x.visitedOn)}, {plural(x.units, 'unit')} <Age d={x.days} limit={LIMITS.notesApproval} /></li>)}
  </Queue>,
  uninvoiced: (q) => <Queue title="Approved, not yet sent for invoicing" hint="Send the invoicing sheet to admin." n={q.uninvoiced.length}>
    {q.uninvoiced.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}`}>{x.property}</a>: visit {us(x.visitedOn)}, {plural(x.units, 'unit')} <Age d={x.days} /></li>)}
  </Queue>,
  invoiceNoRef: (q) => <Queue title="Sent for invoicing, no invoice number yet" hint="Record the admin's invoice number when it comes back." n={q.invoiceNoRef.length}>
    {q.invoiceNoRef.map((x, i) => <li key={i}>{x.visitId ? <a href={`/visits/${x.visitId}`}>{x.property}</a> : x.property}: sent {us(x.submittedOn)} <Age d={x.days} limit={LIMITS.invoiceRef} /></li>)}
  </Queue>,
  idUpdates: (q) => <Queue title="ID updates not yet sent" hint="Download the ID update workbook and send it to billing." n={q.idUpdates.length}>
    {q.idUpdates.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}/ids`}>{x.property}</a>: visit {us(x.visitedOn)}, {plural(x.rows, 'change')} <Age d={x.days} /></li>)}
  </Queue>,
  idUnconfirmed: (q) => <Queue title={`ID updates sent, not confirmed after ${LIMITS.idConfirm} days`} hint="No audit or check-in shows the new ID yet. Check with billing." n={q.idUnconfirmed.length}>
    {q.idUnconfirmed.map((x) => <li key={x.visitId}><a href={`/visits/${x.visitId}/ids`}>{x.property}</a>: visit {us(x.visitedOn)}, {plural(x.rows, 'change')} <Age d={x.days} limit={LIMITS.idConfirm} /></li>)}
  </Queue>,
  readyToClose: (q) => <Queue title="Jobs ready to close" hint="Serviced, invoiced, verified and IDs confirmed." n={q.readyToClose.length}>
    {q.readyToClose.map((x) => <li key={x.jobId}><a href={`/jobs/${x.jobId}`}>{x.property} #{x.number} {x.title}</a> <Age d={x.days} /></li>)}
  </Queue>,
  staleDrafts: (q) => <Queue title={`Drafts older than ${LIMITS.staleDraft} days`} hint="Issue them or delete them." n={q.staleDrafts.length}>
    {q.staleDrafts.map((x) => <li key={x.documentId}><a href={`/documents/${x.documentId}`}>{x.property} {x.type} {x.number}</a> <Age d={x.days} limit={LIMITS.staleDraft} /></li>)}
  </Queue>,
};

export function Today({ q, order }: { q: Queues; order: QueueKey[] }) {
  const empty = order.every((k) => !q[k].length);
  return (
    <section className="card" style={{ marginBottom: '1.25rem' }}>
      <h2 style={{ marginTop: 0 }}>Today</h2>
      {empty && <p className="small">Nothing is waiting on you.</p>}
      {order.map((k) => <div key={k} data-queue={k}>{QUEUES[k](q)}</div>)}
    </section>
  );
}
