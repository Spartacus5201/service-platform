-- One direction for the visit <-> WA link: visit.document_id. document.visit_id was never set.
ALTER TABLE document DROP COLUMN visit_id;

-- The business date of a document (the date in its number), so it can be compared with visit and audit dates.
ALTER TABLE document ADD COLUMN created_on date;
UPDATE document SET created_on = created_at::date;
ALTER TABLE document ALTER COLUMN created_on SET NOT NULL;
ALTER TABLE document ALTER COLUMN created_on SET DEFAULT current_date;

CREATE INDEX visit_document ON visit (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX document_line_endpoint ON document_line (endpoint_id) WHERE endpoint_id IS NOT NULL;
