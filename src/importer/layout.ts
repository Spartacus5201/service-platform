// A layout is a saved description of one report format: which header names mean which app field.
// Layouts are plain data so a new report type is added by saving a map, not by writing code.
import type { FieldType } from './convert';
import type { Cell } from '../parsers/common';

export type Target = 'devices' | 'unit_directory';

export interface FieldDef { key: string; label: string; type: FieldType; required?: boolean; help?: string }

export interface ColumnRule {
  field: string;
  /** Header names that mean this field, any spelling the reports use. Compared after normHeader. */
  headers: string[];
  required?: boolean;
  /** Used when the cell is blank. */
  default?: string;
  /** Raw value (normalised) to the value the converter should see, e.g. { "null": "0" } or { "irrigation": "WS" }. */
  lookup?: Record<string, string>;
}

export interface Layout {
  id: string; name: string; version: number; target: Target;
  /** Where the file usually comes from, shown to people choosing a layout. */
  source?: string;
  columns: ColumnRule[];
  /** Header names that must all be present for a file to be this layout (on top of the required columns). */
  signature?: string[];
  /** A row is skipped as empty when every one of these fields is blank. */
  emptyWhen: string[];
  /** How many rows from the top to look for the header (default 15). */
  headerWithin?: number;
}

/** Per-file overrides chosen by a person in the wizard. All optional; stored with the import. */
export interface Overrides {
  sheet?: string;
  /** 1-based row number of the header row. */
  headerRow?: number;
  /** field -> 1-based column number, or null to leave the field unmapped. */
  columns?: Record<string, number | null>;
  /** field -> one value for every row (e.g. the service for a water-only file). */
  constants?: Record<string, string>;
  /** field -> extra raw-to-value lookups, added to the layout's own. */
  lookups?: Record<string, Record<string, string>>;
  /** 1-based row numbers a person has chosen to leave out, with the reason kept by the caller. */
  excludeRows?: number[];
}

/** Header comparison ignores case, spacing and punctuation: "Bldg #" = "bldg", "Battery Level %" = "batterylevel". */
export const normHeader = (v: Cell | undefined) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** Lookup keys ignore case and outer spaces. */
export const normValue = (v: string) => v.trim().toLowerCase();
