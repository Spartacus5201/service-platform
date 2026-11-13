-- Corrections: an event entered by mistake is voided (kept, hidden from history, billing and search), never deleted.
ALTER TABLE service_event ADD COLUMN voided boolean NOT NULL DEFAULT false;
ALTER TABLE service_event ADD COLUMN void_reason text;

-- A device that was voided (never really installed) no longer holds its ID, so the ID can be entered again correctly.
DROP INDEX device_hw_unique;
CREATE UNIQUE INDEX device_hw_unique ON device (property_id, kind, hardware_id) WHERE hardware_id IS NOT NULL AND status <> 'removed';
