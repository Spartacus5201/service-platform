-- A job is one piece of work for one property, from the request to the invoice.
-- Its stage is derived from what is linked to it; only the request itself and the close are typed in.
-- Authorization and scheduling are tracked on the Salesforce case (salesforce_status mirrors it).
CREATE TABLE job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number serial UNIQUE,
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  title text NOT NULL,
  source text NOT NULL DEFAULT 'other' CHECK (source IN ('salesforce','phone','email','audit','other')),
  requested_on date NOT NULL DEFAULT current_date,
  requested_by text,
  request_notes text,
  salesforce_case text,
  salesforce_status text,
  closed_on date,
  close_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_property ON job (property_id);

ALTER TABLE document ADD COLUMN job_id uuid REFERENCES job(id);
ALTER TABLE document ADD COLUMN source_batch_id uuid REFERENCES import_batch(id) ON DELETE SET NULL;
ALTER TABLE visit ADD COLUMN job_id uuid REFERENCES job(id);
ALTER TABLE import_batch ADD COLUMN job_id uuid REFERENCES job(id);
CREATE INDEX document_job ON document (job_id);
CREATE INDEX visit_job ON visit (job_id);

-- Existing work: one job per document (with its audit and visits), one per visit that had no document.
DO $$
DECLARE d record; v record; j uuid;
BEGIN
  FOR d IN SELECT * FROM document ORDER BY created_on, created_at LOOP
    INSERT INTO job (property_id, title, source, requested_on, salesforce_case, created_by)
      VALUES (d.property_id, COALESCE(d.title, d.type || ' ' || d.number), CASE WHEN d.source_batch_id IS NULL THEN 'other' ELSE 'audit' END, d.created_on, d.salesforce_case, d.created_by)
      RETURNING id INTO j;
    UPDATE document SET job_id=j WHERE id=d.id;
    UPDATE visit SET job_id=j WHERE document_id=d.id;
    IF d.source_batch_id IS NOT NULL THEN UPDATE import_batch SET job_id=j WHERE id=d.source_batch_id AND job_id IS NULL; END IF;
  END LOOP;
  FOR v IN SELECT * FROM visit WHERE job_id IS NULL ORDER BY visited_on LOOP
    INSERT INTO job (property_id, title, source, requested_on, salesforce_case, created_by)
      VALUES (v.property_id, 'Service visit ' || v.visited_on::text, 'other', v.visited_on, v.salesforce_case, v.created_by) RETURNING id INTO j;
    UPDATE visit SET job_id=j WHERE id=v.id;
  END LOOP;
END $$;
