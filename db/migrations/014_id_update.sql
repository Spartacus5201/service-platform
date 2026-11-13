-- Port and Net: the billing system's addressing for a meter (almost always 0). Stored per endpoint; the billing system stays the source of truth.
ALTER TABLE endpoint ADD COLUMN port text NOT NULL DEFAULT '0';
ALTER TABLE endpoint ADD COLUMN net text NOT NULL DEFAULT '0';

-- The ID update record: what the billing system holds now (old_*), and what it should hold after the visit (new_*).
CREATE TABLE id_update (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES visit(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES endpoint(id),
  old_mdid text, old_miuid text, old_port text, old_net text,
  new_mdid text, new_miuid text, new_port text, new_net text,
  system_type text, meter_type text,
  recoup boolean NOT NULL DEFAULT false,              -- old transmitter returned to stock
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','exported','confirmed')),
  exported_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by_batch uuid REFERENCES import_batch(id),
  UNIQUE (visit_id, endpoint_id)
);
