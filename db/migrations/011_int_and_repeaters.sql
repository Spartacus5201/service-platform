-- INT rule: an automated unit with few reads and no real read for several days before the audit ended is serviced like an NT.
ALTER TABLE audit_reading ADD COLUMN last_real_on date;      -- MaxRealDate in the Manual Audit
UPDATE setting SET value='5' WHERE key='int_read_threshold' AND value='10';   -- now "at most this many reads"
INSERT INTO setting (key, value) VALUES ('int_stale_days', '3') ON CONFLICT (key) DO NOTHING;
-- Repeaters are shown by where they sit.
ALTER TABLE device ADD COLUMN location text;

-- Reviewer action for property-requested inspections and usage accuracy tests.
ALTER TABLE audit_override DROP CONSTRAINT IF EXISTS audit_override_action_check;
ALTER TABLE audit_override ADD CONSTRAINT audit_override_action_check CHECK (action IN ('No action','Needs Service','Verify ID','Investigate','Requested by property','Unrecognized'));
