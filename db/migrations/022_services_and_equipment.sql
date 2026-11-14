-- Service codes as an editable list, and the equipment registry.

-- Codes are the ServiceID the billing system uses; they never change once made (endpoints are keyed on them).
-- `words` are how other reports name the service ("All Water", "Hot Water"); a report value is read as the code
-- whose code or words match it exactly (ignoring case and punctuation).
CREATE TABLE service_type (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  name text NOT NULL,
  words text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,          -- false = retired: still read on old files, not offered for new work
  sort int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO service_type (code, name, words, sort) VALUES
  ('WS', 'Water',                 ARRAY['water','all water','cold water','domestic water','potable water'], 1),
  ('GS', 'Gas',                   ARRAY['gas','natural gas'], 2),
  ('EL', 'Electric',              ARRAY['electric','electricity','elec'], 3),
  ('HW', 'Hot Water',             ARRAY['hot water','domestic hot water'], 4),
  ('CW', 'Chilled Water',         ARRAY['chilled water'], 5),
  ('HV', 'HVAC',                  ARRAY['hvac','heating','cooling','heating and cooling','btu'], 6),
  ('WA', 'Water (alternate code)', ARRAY[]::text[], 7);

-- One row per equipment model. `model` is the code reports use (TR4, TR201); `aliases` are other spellings.
-- Prices are never stored here: the model points at catalog parts, which keep their own dated prices.
CREATE TABLE equipment_model (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer text NOT NULL,
  model text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('meter','transmitter','combo','repeater','collector','receiver')),
  reading_system text,
  services text[] NOT NULL DEFAULT '{}',
  aliases text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','phasing_out','obsolete')),
  replaced_by uuid REFERENCES equipment_model(id),
  part_item_id uuid REFERENCES catalog_item(id),       -- the part quoted to replace one of these
  battery_item_id uuid REFERENCES catalog_item(id),    -- the battery it takes
  battery_life_years numeric(4,1),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (replaced_by IS NULL OR replaced_by <> id)
);
CREATE UNIQUE INDEX equipment_model_name_uq ON equipment_model (lower(manufacturer), lower(model));
