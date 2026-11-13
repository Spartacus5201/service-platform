-- Labor is priced per line, separately from the part. Default comes from setting labor_rate; any line can override it.
ALTER TABLE document_line ADD COLUMN labor_price numeric(10,2);
INSERT INTO setting (key, value) VALUES ('labor_rate', '85') ON CONFLICT (key) DO NOTHING;
