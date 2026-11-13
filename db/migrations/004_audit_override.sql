-- A reviewer's correction of the rules' recommendation for one reading. One live row per reading; every change is also written to audit_log.
CREATE TABLE audit_override (
  reading_id uuid PRIMARY KEY REFERENCES audit_reading(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('No action','Needs Service','Verify ID','Investigate','Unrecognized')),
  owner text CHECK (owner IN ('property','service coordinator')),
  component text CHECK (component IN ('meter','transmitter','both','manual_pick')),
  reason text NOT NULL,
  rules_action text NOT NULL,                -- what the rules said when the override was made
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
