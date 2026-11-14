-- "Own records": a visit belongs to the technician who did it. Linked to their user when the technician is a user
-- (recorded from the unit page, or the name matches a user); the typed name stays for people without an account.
ALTER TABLE visit ADD COLUMN technician_id uuid REFERENCES app_user(id);
UPDATE visit v SET technician_id = u.id FROM app_user u
 WHERE v.technician_id IS NULL AND v.technician IS NOT NULL AND lower(trim(v.technician)) = lower(trim(u.name));
CREATE INDEX visit_technician_idx ON visit (technician_id);
