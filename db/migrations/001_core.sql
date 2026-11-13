-- Core schema. Mirrors the Data Model & Screen-Flow Spec (2026-11-06).
-- Plain Postgres: runs on PGlite (local dev) and managed Postgres (production).

-- ---------- Registry ----------
CREATE TABLE property (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id text NOT NULL UNIQUE,             -- appears on every system report; import match key
  name text NOT NULL,
  address text,
  billing_code text,
  amr_vendors text[] NOT NULL DEFAULT '{}',
  installed_by_us boolean NOT NULL DEFAULT false,
  install_completed_on date,                 -- install warranty anchor (single major-completion date)
  salesforce_account_ref text,
  access_notes text,
  scheduling_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  phone text,
  email text,
  is_primary boolean NOT NULL DEFAULT false
);

CREATE TABLE building (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  label text NOT NULL                        -- display only
);

CREATE TABLE unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES building(id) ON DELETE CASCADE,
  current_label text NOT NULL,
  move_in_on date,                           -- NULL = vacant (01/01/00 sentinel in the report)
  prior_move_out_on date,                    -- informational
  occupancy_source text,
  occupancy_as_of date
);

-- Never match a unit by label alone: matching reads this table.
CREATE TABLE unit_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  building_label text NOT NULL,              -- normalized
  unit_label text NOT NULL,                  -- normalized
  valid_from date,
  valid_to date,
  source text
);
CREATE INDEX unit_alias_lookup ON unit_alias (property_id, building_label, unit_label);

-- One metering point (unit + utility). All history anchors here.
CREATE TABLE endpoint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE CASCADE,
  service_code text NOT NULL,                -- WS, GS, ...
  vendor_label text,                         -- such as 1101-C
  is_manual_read boolean NOT NULL DEFAULT false,
  UNIQUE (unit_id, service_code)
);

-- ---------- Equipment ----------
CREATE TABLE device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('meter','transmitter','combo','collector','repeater')),
  hardware_id text,                          -- radio ID; meters have none
  serial_number text,                        -- optional on every device
  model text,
  is_placeholder boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','removed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX device_hw_unique ON device (property_id, kind, hardware_id) WHERE hardware_id IS NOT NULL;

-- Lineage: a device sits at an endpoint (or at the property for collectors and repeaters).
CREATE TABLE installation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  endpoint_id uuid REFERENCES endpoint(id) ON DELETE CASCADE,
  installed_on date,
  removed_on date,
  origin text NOT NULL CHECK (origin IN ('install_project','service','import')),
  location_note text,
  source_ref text
);
CREATE INDEX installation_endpoint ON installation (endpoint_id);

-- ---------- Audits and imports ----------
CREATE TABLE import_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('auto_audit','manual_audit','occupancy','cim_nextcentury','cim_inovonics','psr')),
  filename text,
  sha256 text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid,
  raw_file bytea,                            -- discarded after 180 days (raw_purged_at set)
  purge_after date NOT NULL DEFAULT (current_date + 180),
  raw_purged_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (property_id, kind, sha256)
);

CREATE TABLE audit_reading (                 -- kept permanently (parsed readings)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES endpoint(id) ON DELETE CASCADE,
  read_date_1 date, read_1 numeric,
  read_date_2 date, read_2 numeric,
  usage numeric,
  occ_days integer,
  read_count integer,                        -- Manual Audit only
  audit_result text,
  meter_type_id text,
  manufacturer_id text,
  amr_id text
);
CREATE INDEX audit_reading_endpoint ON audit_reading (endpoint_id, read_date_1);

CREATE TABLE device_checkin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  checked_in_at timestamptz,
  low_battery boolean, tamper boolean, jammed boolean, power_loss boolean, reset boolean,
  signal_level numeric, signal_margin numeric,
  pulse_count numeric
);

-- ---------- Service ----------
CREATE TABLE visit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  visited_on date NOT NULL,
  technician text,
  outcome text NOT NULL CHECK (outcome IN ('completed','unable_to_access','unable_to_complete')),
  salesforce_case text,
  salesforce_work_order text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only. A correction is a new row that supersedes the old one.
CREATE TABLE service_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES visit(id) ON DELETE CASCADE,
  endpoint_id uuid NOT NULL REFERENCES endpoint(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('inspect_test','repair','replace','reprogram','other')),
  issue_code text,
  read_at_service numeric,
  notes text,
  supersedes uuid REFERENCES service_event(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_event_endpoint ON service_event (endpoint_id);

CREATE TABLE event_part (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_event_id uuid NOT NULL REFERENCES service_event(id) ON DELETE CASCADE,
  catalog_item_id uuid,
  old_device_id uuid REFERENCES device(id),
  new_device_id uuid REFERENCES device(id),
  quantity numeric NOT NULL DEFAULT 1
);

-- ---------- Documents and billing ----------
CREATE TABLE catalog_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  kind text NOT NULL CHECK (kind IN ('part','labor')),
  component text CHECK (component IN ('meter','transmitter','combo','collector','repeater')),
  unit text NOT NULL DEFAULT 'each',
  price numeric(12,2),                       -- entered manually in v1
  effective_from date NOT NULL DEFAULT current_date
);

CREATE TABLE document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('WA','Proposal','RFM')),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES visit(id),
  number text NOT NULL UNIQUE,               -- ClassID-YYMMDD, -2, -3 on same-day repeats
  title text,                                -- project name
  acts_as text[],                            -- Proposal only: subset of WA, RFM
  salesforce_case text,
  salesforce_work_order text,
  salesforce_status text,                    -- mirror only; Salesforce owns status
  quote_valid_until date,                    -- issue date + 30 days
  price_reconfirmed_by uuid,
  price_reconfirmed_on date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  version integer NOT NULL,
  issued_at timestamptz,
  issued_by uuid,
  frozen_content jsonb,
  client_pdf bytea,
  tech_pdf bytea,
  UNIQUE (document_id, version)
);

CREATE TABLE document_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES document_version(id) ON DELETE CASCADE,
  endpoint_id uuid REFERENCES endpoint(id),
  audit_reading_id uuid REFERENCES audit_reading(id),
  issue_code text,
  description text,
  catalog_item_id uuid REFERENCES catalog_item(id),
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric(12,2),                  -- hidden from the technician role
  labor_covered boolean NOT NULL DEFAULT false,
  include boolean NOT NULL DEFAULT true
);

CREATE TABLE clause_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,                        -- merge fields like {{property.name}}
  applies_when jsonb,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (key, version)
);

CREATE TABLE invoice_submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  document_id uuid REFERENCES document(id),
  submitted_on date NOT NULL,
  submitted_by uuid,
  external_ref text
);

CREATE TABLE invoice_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES invoice_submission(id) ON DELETE CASCADE,
  service_event_id uuid REFERENCES service_event(id),
  event_part_id uuid REFERENCES event_part(id),
  description text,
  quantity numeric NOT NULL DEFAULT 1,
  amount numeric(12,2),
  billable boolean NOT NULL DEFAULT true,
  override_reason text,
  CHECK (service_event_id IS NOT NULL OR event_part_id IS NOT NULL)
);
-- An event line can be invoiced once.
CREATE UNIQUE INDEX invoice_line_event_once ON invoice_line (service_event_id) WHERE service_event_id IS NOT NULL;
CREATE UNIQUE INDEX invoice_line_part_once ON invoice_line (event_part_id) WHERE event_part_id IS NOT NULL;

-- ---------- Platform ----------
CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','office','coordinator','technician')),
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE setting (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
INSERT INTO setting (key, value) VALUES
  ('int_read_threshold', '10'),
  ('int_window_days', '30'),
  ('warranty_months_install', '12'),
  ('warranty_months_service', '12'),
  ('expiring_window_days', '30'),
  ('quote_valid_days', '30'),
  ('raw_import_retention_days', '180');

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  action text NOT NULL,
  entity text,
  entity_id text,
  detail jsonb
);
