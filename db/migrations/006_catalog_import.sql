-- Price list import. Items from the Inventory sheet carry their source columns; a price change is a new row with a later effective_from.
ALTER TABLE catalog_item
  ADD COLUMN part_type text,
  ADD COLUMN vendor text,
  ADD COLUMN part_number text,
  ADD COLUMN notes text,
  ADD COLUMN source text,                                   -- NULL = typed by hand, 'inventory' = price list import
  ADD COLUMN active boolean NOT NULL DEFAULT true,          -- false = obsolete in the price list; hidden from pickers
  ADD COLUMN suggest_default boolean NOT NULL DEFAULT false; -- imported parts are only auto-suggested on a draft when marked
CREATE INDEX catalog_item_source_idx ON catalog_item (source, lower(name));
