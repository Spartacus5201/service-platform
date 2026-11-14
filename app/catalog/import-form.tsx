'use client';
import { useActionState } from 'react';
import { importCatalogAction } from '../server-actions/catalog';
import type { CatalogImportUi } from '../types';
import { money } from '../ui';

export function CatalogImportForm() {
  const [st, action, pending] = useActionState<CatalogImportUi, FormData>(importCatalogAction, {});
  const r = st.summary;
  return (
    <form action={action} className="card">
      <h2 style={{ marginTop: 0 }}>Import the master price list</h2>
      <p className="small">Choose the inventory workbook saved as .xlsx. The “Inventory” sheet is read; “Sell Price” becomes the price. Rows with no price are skipped, rows marked Obsolete are hidden from pickers.
        A changed price is added as a new row dated today, so old documents keep the price they were issued with. Use Preview first; nothing is saved until you choose Import.</p>
      <div className="row">
        <div className="field" style={{ flex: 2 }}><label htmlFor="file">Price list (.xlsx)</label><input id="file" name="file" type="file" accept=".xlsx" required /></div>
      </div>
      {st.error && <div className="flash error" role="alert">{st.error}</div>}
      {r && (
        <div className="flash ok" role="status">
          <b>{st.applied ? 'Imported.' : 'Preview, nothing saved yet.'}</b> {r.rows} items read: {r.added} new, {r.changed} price change{r.changed === 1 ? '' : 's'}, {r.unchanged} unchanged,
          {' '}{r.skippedNoPrice} skipped (no price), {r.obsolete} marked obsolete.
          {!!st.changes?.length && (
            <ul className="small">{st.changes.map((c, i) => <li key={i}>{c.name}: {money(c.from)} → {money(c.to)}</li>)}</ul>
          )}
        </div>
      )}
      <div className="actions">
        <button className="secondary" type="submit" name="intent" value="preview" disabled={pending}>Preview</button>
        <button type="submit" name="intent" value="apply" disabled={pending}>{pending ? 'Working…' : 'Import'}</button>
      </div>
    </form>
  );
}
