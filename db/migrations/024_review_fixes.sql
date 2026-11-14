-- Code review fixes (docs/REVIEW-2026-11.md).
-- A4: an event can be corrected once; two corrections of the same event at once must not both stand.
CREATE UNIQUE INDEX service_event_supersedes_uq ON service_event (supersedes) WHERE supersedes IS NOT NULL;
-- Hot paths without an index.
CREATE INDEX IF NOT EXISTS audit_reading_batch_idx ON audit_reading (import_batch_id);
CREATE INDEX IF NOT EXISTS device_checkin_device_idx ON device_checkin (device_id, checked_in_at DESC);
