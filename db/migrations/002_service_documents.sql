-- Warranty position is recorded when the work is recorded, so history never shifts if settings change later.
ALTER TABLE service_event
  ADD COLUMN labor_covered boolean NOT NULL DEFAULT false,
  ADD COLUMN part_covered boolean NOT NULL DEFAULT false,
  ADD COLUMN coverage_basis text[] NOT NULL DEFAULT '{}';

ALTER TABLE document_line
  ADD COLUMN part_covered boolean NOT NULL DEFAULT false,
  ADD COLUMN component text;

ALTER TABLE document_version
  ADD COLUMN status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued'));

CREATE INDEX service_event_supersedes ON service_event (supersedes) WHERE supersedes IS NOT NULL;
CREATE INDEX document_property ON document (property_id, created_at);
