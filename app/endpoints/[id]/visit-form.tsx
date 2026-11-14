'use client';
import { useActionState, useState } from 'react';
import { recordVisitAction } from '../../server-actions/field';
import type { FormState } from '../../types';

type Pair = [string, string];
export interface VisitChoices { outcomes: Pair[]; actions: Pair[]; issues: Pair[]; kinds: Pair[] }

export default function VisitForm({ endpointId, propertyId, today, isManual, catalog, choices }: {
  endpointId: string; propertyId: string; today: string; isManual: boolean; catalog: { id: string; name: string }[]; choices: VisitChoices;
}) {
  const opts = (xs: Pair[]) => xs.map(([v, t]) => <option key={v} value={v}>{t}</option>);
  const [st, action, pending] = useActionState<FormState, FormData>(recordVisitAction, {});
  const [act, setAct] = useState('inspect_test');
  const [outcome, setOutcome] = useState('completed');
  return (
    <form action={action} className="card">
      <h2 style={{ marginTop: 0 }}>Record a service visit</h2>
      <input type="hidden" name="endpoint_id" value={endpointId} /><input type="hidden" name="property_id" value={propertyId} />
      <div className="row">
        <div className="field"><label htmlFor="visited_on">Date</label><input id="visited_on" name="visited_on" type="date" defaultValue={today} required /></div>
        <div className="field"><label htmlFor="technician">Technician</label><input id="technician" name="technician" /></div>
        <div className="field"><label htmlFor="outcome">Outcome</label>
          <select id="outcome" name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {opts(choices.outcomes)}
          </select></div>
        <div className="field"><label htmlFor="action">Work done</label>
          <select id="action" name="action" value={act} onChange={(e) => setAct(e.target.value)} disabled={outcome !== 'completed'}>
            {opts(choices.actions)}
          </select></div>
      </div>
      {outcome !== 'completed' && <p className="small">No work is recorded and no warranty clock starts for this outcome.</p>}
      <div className="row">
        <div className="field"><label htmlFor="issue_code">Issue</label>
          <select id="issue_code" name="issue_code" defaultValue=""><option value="">(none)</option>{choices.issues.filter(([c]) => c !== 'OK').map(([c, t]) => <option key={c} value={c}>{c} - {t}</option>)}</select></div>
        <div className="field"><label htmlFor="read_at_service">Read at service</label><input id="read_at_service" className="num" name="read_at_service" inputMode="decimal" /></div>
        <div className="field"><label htmlFor="salesforce_case">Salesforce Case</label><input id="salesforce_case" name="salesforce_case" /></div>
        <div className="field"><label htmlFor="salesforce_work_order">Work Order</label><input id="salesforce_work_order" name="salesforce_work_order" /></div>
      </div>
      {act === 'replace' && outcome === 'completed' && (
        <fieldset className="card" style={{ margin: '0 0 .75rem' }}>
          <legend>Part replaced</legend>
          <div className="row">
            <div className="field"><label htmlFor="repl_kind">Part</label>
              <select id="repl_kind" name="repl_kind" defaultValue={isManual ? 'meter' : 'transmitter'}>{opts(choices.kinds)}</select></div>
            <div className="field"><label htmlFor="new_hardware_id">New transmitter ID</label><input id="new_hardware_id" name="new_hardware_id" /></div>
            <div className="field"><label htmlFor="new_serial">New serial (optional)</label><input id="new_serial" name="new_serial" /></div>
            <div className="field"><label htmlFor="model">Model</label><input id="model" name="model" /></div>
            {!!catalog.length && <div className="field"><label htmlFor="catalog_item_id">Catalog item</label><select id="catalog_item_id" name="catalog_item_id" defaultValue=""><option value="">(none)</option>{catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
          </div>
        </fieldset>
      )}
      <div className="field"><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" /></div>
      {st.error && <div className="flash error" role="alert">{st.error}</div>}
      <div className="actions"><button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save visit'}</button></div>
    </form>
  );
}
