import { getDb } from '@/src/server/db';
import { requireCan } from '@/src/server/session';
import { today } from '@/src/server/dates';
import { DEFAULT_RULES, RULE_ACTIONS, RULE_COMPONENTS, RULE_OWNERS, type Rule, type Recommendation } from '@/src/rules/audit';
import { getDraft, loadRules, sameRule, testRules } from '@/src/rules/table';
import { loadLists } from '@/src/lists/lists';
import { loadSettings } from '@/src/queries/audit';
import { discardRulesAction, saveRulesAction, testRulesAction } from '../../server-actions/rules';
import { Badge, Flash, one, us, type SP } from '../../ui';

const ACTION_TEXT: Record<string, string> = { Unrecognized: 'Review manually' };
const PART_TEXT: Record<string, string> = { transmitter: 'Transmitter', meter: 'Meter', manual_pick: 'Technician decides', none: 'None' };
const rec = (r: Recommendation) => [ACTION_TEXT[r.action] ?? r.action, r.owner, r.component && PART_TEXT[r.component]].filter(Boolean).join(' · ');

function Side({ code, p, o, label }: { code: string; p: 'o' | 'v'; o: Rule['occupied']; label: string }) {
  return (
    <div className="row" style={{ alignItems: 'flex-end', marginTop: '.25rem' }}>
      <div className="field" style={{ flex: '0 0 6rem' }}><span className="small">{label}</span></div>
      <div className="field"><label htmlFor={`${p}a_${code}`} className="small">Recommend</label>
        <select id={`${p}a_${code}`} name={`${p}a_${code}`} defaultValue={o.action}>{RULE_ACTIONS.map((a) => <option key={a} value={a}>{ACTION_TEXT[a] ?? a}</option>)}</select></div>
      <div className="field"><label htmlFor={`${p}o_${code}`} className="small">Owner</label>
        <select id={`${p}o_${code}`} name={`${p}o_${code}`} defaultValue={o.owner ?? ''}><option value="">—</option>{RULE_OWNERS.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
      <div className="field" style={{ flex: 3 }}><label htmlFor={`${p}r_${code}`} className="small">Reason shown</label>
        <input id={`${p}r_${code}`} name={`${p}r_${code}`} defaultValue={o.reason} /></div>
    </div>
  );
}

export default async function RulesPage({ searchParams }: { searchParams: SP }) {
  const me = await requireCan('rules.edit');
  const sp = await searchParams; const db = await getDb();
  const [current, draft, lists, { audit }] = await Promise.all([loadRules(db), getDraft(db, me.userId), loadLists(db), loadSettings(db)]);
  const shown = draft ?? current;
  const test = draft ? await testRules(db, draft, { asOf: today() }) : null;
  const codes = [...new Set([...lists.items('audit_code').map((i) => i.code), ...Object.keys(shown)])];
  const blank: Rule = { component: 'none', method: 'standard', occupied: { action: 'Unrecognized', owner: null, reason: 'Review manually' }, vacant: { action: 'Unrecognized', owner: null, reason: 'Review manually' } };
  return (
    <>
      <h1>Audit rules</h1>
      <p className="sub">What each audit code means: the recommendation, who owns it, and the part it points at. <a href="/admin">Back to Admin</a> · <a href="/admin/lists?list=audit_code">Audit codes</a></p>
      <Flash msg={one(sp.msg)} error={one(sp.error)} />
      <p className="small">
        Changes are tested before they are saved: <b>Test changes</b> runs the latest audit of every property with the new rules and shows each unit whose recommendation would change,
        and how often the rules agree with what reviewers decided. Only a tested draft can be saved. Saved rules apply to every audit view and new document from then on;
        reviewer decisions, issued documents and recorded service keep what they were made with. Unknown occupancy is treated as occupied.
        The <i>Intermittent</i> method counts reads: {audit.intReadThreshold} reads or fewer, with no real read for {audit.intStaleDays} days, needs service (numbers in Admin settings).
      </p>
      {draft && <p className="flash" style={{ background: 'var(--warn-bg, #fff4e5)' }}>You have a draft that is not saved. The form shows the draft.</p>}

      <form action={testRulesAction}>
        {codes.map((code) => {
          const item = lists.get('audit_code', code);
          const added = !!item && !item.builtin;
          const own = shown[code];
          const r = own ?? (item?.worksLike ? shown[item.worksLike] : undefined) ?? blank;
          const changedFromBuiltin = !added && !sameRule(DEFAULT_RULES[code], own);
          return (
            <fieldset key={code} className="card" style={{ marginBottom: '.75rem' }} data-code={code}>
              <input type="hidden" name="code" value={code} />
              <legend><b>{code}</b> {item?.label ?? ''} {added && <Badge>added, works like {item!.worksLike}</Badge>}{!added && !DEFAULT_RULES[code] && !own && <Badge>no rule</Badge>} {changedFromBuiltin && <Badge tone="warn">changed from built-in</Badge>}</legend>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                {!DEFAULT_RULES[code] && <div className="field"><label htmlFor={`mode_${code}`} className="small">Rule</label>
                  <select id={`mode_${code}`} name={`mode_${code}`} defaultValue={own ? 'own' : 'like'}><option value="like">{item?.worksLike && added ? `Same as ${item.worksLike}` : 'No rule (review manually)'}</option><option value="own">Its own rule (below)</option></select></div>}
                <div className="field"><label htmlFor={`comp_${code}`} className="small">Part</label>
                  <select id={`comp_${code}`} name={`comp_${code}`} defaultValue={r.component}>{RULE_COMPONENTS.map((c) => <option key={c} value={c}>{PART_TEXT[c]}</option>)}</select></div>
                <div className="field"><label htmlFor={`method_${code}`} className="small">Method</label>
                  <select id={`method_${code}`} name={`method_${code}`} defaultValue={r.method}><option value="standard">By occupancy</option><option value="intermittent">Intermittent (count reads)</option></select></div>
              </div>
              {r.method === 'intermittent' ? <p className="small" style={{ margin: '.25rem 0 0' }}>Counted by reads; the outcomes below are kept for when the method is changed.</p> : null}
              <Side code={code} p="o" o={r.occupied} label="Occupied" />
              <Side code={code} p="v" o={r.vacant} label="Vacant" />
            </fieldset>
          );
        })}
        <div className="actions"><button type="submit">{draft ? 'Test again' : 'Test changes'}</button></div>
      </form>

      {test && (
        <section id="test" className="card" style={{ marginTop: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Test of the draft</h2>
          {!test.codes.length ? <p>The draft is the same as the rules in force.</p> : <>
            <p>Changes rules for <b>{test.codes.join(', ')}</b>. Ran the latest audit of {test.audits} propert{test.audits === 1 ? 'y' : 'ies'} ({test.units} units):
              {' '}<b>{test.changed.length}</b> unit{test.changed.length === 1 ? '' : 's'} would get a different recommendation.</p>
            {test.reviewed > 0 && <p>Units a reviewer decided: {test.reviewed}. The rules agree with the reviewer on {test.agreeBefore} now and on {test.agreeAfter} with the draft
              {' '}{test.agreeAfter > test.agreeBefore ? <Badge tone="ok">better</Badge> : test.agreeAfter < test.agreeBefore ? <Badge tone="warn">worse</Badge> : <Badge>same</Badge>}.</p>}
            {test.changed.length > 0 && <div className="tablewrap"><table>
              <thead><tr><th>Property</th><th>Audit</th><th>Unit</th><th>Code</th><th>Now</th><th>With the draft</th><th>Reviewer decided</th></tr></thead>
              <tbody>{test.changed.slice(0, 300).map((c, i) => (
                <tr key={i}><td><a href={`/properties/${c.propertyId}/audits/${c.batchId}`}>{c.property}</a></td><td>{us(c.auditedOn)}</td><td>{c.building}-{c.unit} {c.service}</td><td>{c.code}</td>
                  <td>{rec(c.before)}</td><td><b>{rec(c.after)}</b></td><td>{c.reviewer ?? ''}</td></tr>))}</tbody>
            </table></div>}
            {test.changed.length > 300 && <p className="small">Showing the first 300.</p>}
          </>}
          <div className="actions">
            {test.codes.length > 0 && <form action={saveRulesAction} style={{ display: 'inline' }}><button type="submit">Save these rules</button></form>}
            {' '}<form action={discardRulesAction} style={{ display: 'inline' }}><button className="secondary" type="submit">Discard draft</button></form>
          </div>
        </section>
      )}
    </>
  );
}
