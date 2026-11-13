-- Unit Directory exports (move-in dates) are an occupancy source. Their resident names, account numbers and balances are never read or stored.
ALTER TABLE import_batch DROP CONSTRAINT IF EXISTS import_batch_kind_check;
ALTER TABLE import_batch ADD CONSTRAINT import_batch_kind_check CHECK (kind IN ('auto_audit','manual_audit','occupancy','cim_nextcentury','cim_inovonics','psr','unit_directory'));
