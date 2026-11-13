-- Street address of the unit, taken from the audit's ServiceAddr (ClassID prefix and occupancy dates removed).
ALTER TABLE unit ADD COLUMN service_address text;
