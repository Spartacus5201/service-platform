// SQL fragments shared by every query that reads service history. One copy, so a rule cannot drift.

/** Service events that still stand (not voided, not replaced by a correction), for a table aliased `alias`. */
export const liveEvent = (alias: string) => `(NOT ${alias}.voided AND NOT EXISTS (SELECT 1 FROM service_event sup_${alias} WHERE sup_${alias}.supersedes = ${alias}.id))`;
/** The same, for the usual alias `se`. */
export const LIVE_EVENT = liveEvent('se');

/**
 * Catalog parts as of a date: the newest price row of each part (same name, part type, part number and source)
 * effective on or before the date. Filter on `active` AFTER this, so an obsolete part never falls back to an older
 * price. `asOf` is a parameter placeholder such as '$2'.
 */
export const CATALOG_AS_OF = (asOf: string) => `(SELECT DISTINCT ON (lower(name), lower(coalesce(part_type,'')), lower(coalesce(part_number,'')), coalesce(source,'')) *
     FROM catalog_item WHERE effective_from <= ${asOf}
    ORDER BY lower(name), lower(coalesce(part_type,'')), lower(coalesce(part_number,'')), coalesce(source,''), effective_from DESC, id)`;
