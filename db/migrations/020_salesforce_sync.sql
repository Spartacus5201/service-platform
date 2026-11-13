-- When a job's Salesforce status was last read from Salesforce (null: typed by hand).
ALTER TABLE job ADD COLUMN salesforce_synced_at timestamptz;
