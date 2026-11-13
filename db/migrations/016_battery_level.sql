-- Battery level (percent) from the Next Century AMR Status Report; low_battery stays for reports with a yes/no flag.
ALTER TABLE device_checkin ADD COLUMN battery_level numeric;

-- Batteries are their own catalog component (price differs by transmitter model).
ALTER TABLE catalog_item DROP CONSTRAINT IF EXISTS catalog_item_component_check;
ALTER TABLE catalog_item ADD CONSTRAINT catalog_item_component_check CHECK (component IN ('meter','transmitter','combo','collector','repeater','battery'));
