-- Problems found by an import that need a person: units not on file, transmitter IDs that differ from our record.
-- They stay open until resolved (automatically when the records catch up, or by hand) or dismissed with a reason.
CREATE TABLE import_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  import_batch_id uuid REFERENCES import_batch(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('unmatched_unit','id_mismatch')),
  building text NOT NULL, unit text NOT NULL, service text NOT NULL DEFAULT '',
  was text, now text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  note text, resolved_at timestamptz, resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_issue_open ON import_issue (property_id) WHERE status = 'open';
