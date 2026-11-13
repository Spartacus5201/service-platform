-- Service Notes close-out: what the technician reported, the customer-friendly version, photos, and approval.
ALTER TABLE visit ADD COLUMN document_id uuid REFERENCES document(id);          -- the WA this visit closes, if any
ALTER TABLE visit ADD COLUMN notes_status text NOT NULL DEFAULT 'draft' CHECK (notes_status IN ('draft','approved'));
ALTER TABLE visit ADD COLUMN approved_by uuid;
ALTER TABLE visit ADD COLUMN approved_at timestamptz;
ALTER TABLE visit ADD COLUMN client_summary text;                                -- optional paragraph at the top of the client notes

-- Facts about the work (corrected by superseding the event, like the rest).
ALTER TABLE service_event ADD COLUMN result text CHECK (result IN ('repaired','replaced','reprogrammed','no_fault_found','unable_to_access','unable_to_complete','other'));
ALTER TABLE service_event ADD COLUMN end_read numeric;                           -- read_at_service is the start read

-- Wording for the client. Editing it never touches the history, so it lives beside the event.
CREATE TABLE event_note (
  service_event_id uuid PRIMARY KEY REFERENCES service_event(id) ON DELETE CASCADE,
  client_comment text,
  extra_comment text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE visit_photo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES visit(id) ON DELETE CASCADE,
  endpoint_id uuid REFERENCES endpoint(id),
  filename text NOT NULL,
  mime text NOT NULL,
  bytes bytea NOT NULL,
  caption text,
  include_in_client boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visit_photo_visit ON visit_photo (visit_id);
