export interface FormState { error?: string }
export interface ImportUi {
  error?: string;
  kind?: string;
  duplicate?: boolean;
  rows?: number;
  readings?: number;
  devices?: number;
  checkins?: number;
  unitsCreated?: number;
  occupancyUpdated?: number;
  unmatched?: { building: string; unit: string; service: string }[];
  idChanges?: { building: string; unit: string; was: string; now: string }[];
  idElsewhere?: { building: string; unit: string; hardwareId: string; at: string }[];
  warnings?: string[];
  auditUrl?: string;
  wizardUrl?: string;
}

export interface SecretState { error?: string; password?: string; who?: string }

export interface CatalogImportUi {
  error?: string;
  applied?: boolean;
  summary?: { rows: number; added: number; changed: number; unchanged: number; skippedNoPrice: number; obsolete: number };
  changes?: { name: string; from: number | null; to: number }[];
  addedSample?: string[];
}
