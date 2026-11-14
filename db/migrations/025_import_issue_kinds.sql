-- B2: a transmitter ID reported for one unit but on record at another is kept as an import problem.
ALTER TABLE import_issue DROP CONSTRAINT IF EXISTS import_issue_kind_check;
ALTER TABLE import_issue ADD CONSTRAINT import_issue_kind_check CHECK (kind IN ('unmatched_unit','id_mismatch','id_elsewhere'));

-- B1: vendor wording seen in Inovonics reports ("Water-All") is on the service list, so nothing falls back to water.
UPDATE service_type SET words = words || ARRAY['water-all','water-cold'] WHERE code='WS' AND NOT ('water-all' = ANY(words));
UPDATE service_type SET words = words || ARRAY['water-hot'] WHERE code='HW' AND NOT ('water-hot' = ANY(words));
