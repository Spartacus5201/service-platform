-- Audit rules as a table (src/rules/audit.ts has the built-in table; src/rules/table.ts reads and saves).
-- A row exists only where the rule differs from the built-in one; deleting a row restores the built-in rule.
CREATE TABLE audit_rule (
  code       text PRIMARY KEY,
  rule       jsonb NOT NULL,             -- { component, method, occupied: {action, owner, reason}, vacant: {...} }
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Proposed rules waiting to be saved: one per person. Saving is only possible from a tested draft.
CREATE TABLE audit_rule_draft (
  user_id    uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  rules      jsonb NOT NULL,             -- the whole proposed table
  created_at timestamptz NOT NULL DEFAULT now()
);
