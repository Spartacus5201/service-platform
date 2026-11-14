-- Import wizard: saved column maps (versioned, never edited in place), files waiting in the wizard,
-- and which map and choices each import used, so any import can be explained later.
CREATE TABLE import_layout (
  id text NOT NULL,
  version int NOT NULL,
  name text NOT NULL,
  target text NOT NULL,
  definition jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  PRIMARY KEY (id, version)
);

CREATE TABLE import_upload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  filename text,
  bytes bytea,                                -- removed once imported or discarded; files older than 7 days are purged
  state jsonb NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  import_batch_id uuid
);

ALTER TABLE import_batch ADD COLUMN layout_id text, ADD COLUMN layout_version int, ADD COLUMN import_overrides jsonb;
