-- Setup export and import (src/admin/setup.ts), and history so any past document can be explained.

-- The setup as it was before each setup import, so an import can be undone.
CREATE TABLE setup_snapshot (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at   timestamptz NOT NULL DEFAULT now(),
  taken_by   uuid REFERENCES app_user(id),
  reason     text NOT NULL,
  content    jsonb NOT NULL
);

-- Every saved version of an audit rule. rule NULL = back to the built-in rule (or, for an added code, the code it works like).
-- Before a code's first row, the built-in rule applied.
CREATE TABLE audit_rule_version (
  id        serial PRIMARY KEY,
  code      text NOT NULL,
  rule      jsonb,
  saved_at  timestamptz NOT NULL DEFAULT now(),
  saved_by  uuid REFERENCES app_user(id)
);
CREATE INDEX audit_rule_version_code_idx ON audit_rule_version (code, saved_at);
INSERT INTO audit_rule_version (code, rule, saved_at, saved_by) SELECT code, rule, updated_at, updated_by FROM audit_rule;

-- Every change to a property's own prices: the price from that day on (NULL = removed).
CREATE TABLE property_price_history (
  id          serial PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  item        text NOT NULL,
  price       numeric(10,2),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  uuid REFERENCES app_user(id)
);
CREATE INDEX property_price_history_idx ON property_price_history (property_id, item, changed_at);
INSERT INTO property_price_history (property_id, item, price, changed_at) SELECT property_id, item, price, '2000-01-01' FROM property_price;

-- A setup file (or snapshot) waiting to be imported, one per person: previewed first, then imported or cancelled.
CREATE TABLE setup_import_draft (
  user_id    uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  source     text NOT NULL,              -- file name, or "Snapshot of <date>"
  content    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
