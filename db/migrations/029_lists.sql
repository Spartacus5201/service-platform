-- Editable lists (src/lists/lists.ts). Built-in items live in code; this table holds what people changed and added.
-- Rows are never deleted by the app except to put a built-in item back as shipped; items are retired instead.
CREATE TABLE list_item (
  list       text NOT NULL,
  code       text NOT NULL,                        -- what records store; never changes once made
  label      text NOT NULL,
  wording    text,                                 -- client wording, for lists that have it
  works_like text,                                 -- for an added item in a "works like" list: the built-in code
  active     boolean NOT NULL DEFAULT true,        -- false = retired: still read on old records, not offered
  sort       int NOT NULL DEFAULT 100,
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list, code)
);

-- An added action or result is stored as the built-in it works like (every rule keeps working) plus the item picked.
ALTER TABLE service_event ADD COLUMN action_item text;
ALTER TABLE service_event ADD COLUMN result_item text;

-- Free lists: the values are checked against the list by the app, so the fixed checks go.
ALTER TABLE job DROP CONSTRAINT IF EXISTS job_source_check;
ALTER TABLE property_system DROP CONSTRAINT IF EXISTS property_system_milestone_kind_check;
