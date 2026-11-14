-- Starter registry: models confirmed by the service team. Parts and batteries are linked on the Equipment page
-- once the price list is imported (the form suggests the matching catalog parts).
INSERT INTO equipment_model (manufacturer, model, kind, reading_system, services, aliases, status, notes)
VALUES ('Next Century', 'TR4', 'transmitter', 'Next Century', ARRAY['WS'], ARRAY['NC-TR4'], 'current', 'Comes with a battery fitted.')
ON CONFLICT DO NOTHING;
INSERT INTO equipment_model (manufacturer, model, kind, reading_system, services, status, replaced_by, notes)
SELECT 'Next Century', 'TR201', 'transmitter', 'Next Century', ARRAY['WS'], 'obsolete', m.id, 'No longer made; replace with TR4.'
  FROM equipment_model m WHERE lower(m.manufacturer)='next century' AND lower(m.model)='tr4'
ON CONFLICT DO NOTHING;
