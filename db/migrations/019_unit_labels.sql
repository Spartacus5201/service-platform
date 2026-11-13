-- Audit files pad numbers ("0001", "000101"). Show them as the property does ("1", "101").
-- Matching already ignores leading zeros (unit_alias uses normalized labels), so this only changes display.
UPDATE building SET label = regexp_replace(label, '^0+(?=[0-9])', '') WHERE label ~ '^0+[0-9]+$';
UPDATE unit SET current_label = regexp_replace(current_label, '^0+(?=[0-9])', '') WHERE current_label ~ '^0+[0-9]+$';
