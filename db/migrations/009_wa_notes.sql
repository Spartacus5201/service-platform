-- WA Notes: how a property's system is set up, what the technician needs, and any property-specific prices.
ALTER TABLE property ADD COLUMN msa boolean NOT NULL DEFAULT false;   -- meter service agreement: charge code 21

CREATE TABLE property_system (
  property_id        uuid PRIMARY KEY REFERENCES property(id) ON DELETE CASCADE,
  utilities          jsonb NOT NULL DEFAULT '[]',   -- [{ "utility": "Water", "device": "MM FAM" }]
  system_brand       text,                          -- Inovonics, NextCentury, ...
  system_id          text,                          -- collector or gateway ID
  collector_location text,
  milestone_kind     text CHECK (milestone_kind IN ('Install Complete','Takeover','Upgraded')),
  milestone_on       date,
  tech_note          text,
  transmitter_device text,                          -- what the technician installs for a transmitter
  meter_device       text,                          -- and for a meter
  equipment          jsonb NOT NULL DEFAULT '[]',   -- extra items to bring: [{ "qty": 1, "device": "Zenner ETR Programmer" }]
  updated_by         uuid REFERENCES app_user(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Prices that replace the catalog or the default labor rate for one property. item: Labor, Meter, Transmitter, ...
CREATE TABLE property_price (
  property_id uuid NOT NULL REFERENCES property(id) ON DELETE CASCADE,
  item        text NOT NULL,
  price       numeric(10,2) NOT NULL,
  PRIMARY KEY (property_id, item)
);
