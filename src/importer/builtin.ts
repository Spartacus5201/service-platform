// Layouts that ship with the app. Each must reproduce its hand-written parser exactly (tests/importer.test.ts).
import type { Layout } from './layout';

export const AMR_STATUS: Layout = {
  id: 'nextcentury-amr-status', name: 'Next Century AMR Status Report', version: 1, target: 'devices',
  source: 'Next Century portal: AMR Status Report (.csv)', headerWithin: 10,
  signature: ['Building', 'Unit', 'Serial Number', 'Last Check In'],
  columns: [
    { field: 'building', headers: ['Building'] },
    { field: 'unit', headers: ['Unit'], required: true },
    // A blank utility is water (the report is water-only in practice). Wording the app does not recognise
    // stops the row so a person maps it; the old parser silently made it water.
    { field: 'service', headers: ['Utility Type'], default: 'WS' },
    { field: 'hardware_id', headers: ['Serial Number'], required: true },
    { field: 'meter_label', headers: ['Meter Id'] },
    { field: 'transmitter_model', headers: ['Model'] },
    { field: 'battery_level', headers: ['Battery Level', 'Battery Level %'] },
    { field: 'last_check_in', headers: ['Last Check In'] },
    { field: 'meter_model', headers: ['Meter Type'] },
    { field: 'read', headers: ['Meter Read'] },
    { field: 'usage', headers: ['Meter Usage'] },
  ],
  emptyWhen: ['building', 'unit'],
};

export const UNIT_DIRECTORY: Layout = {
  id: 'minoldirect-unit-directory', name: 'MinolDirect Unit Directory', version: 1, target: 'unit_directory',
  source: 'MinolDirect: Unit Directory export (.csv). Name, account, balance and customer ID are never read.', headerWithin: 1,
  signature: ['Bldg #', 'Unit #', 'Start Date'],
  columns: [
    { field: 'building', headers: ['Bldg #', 'Building'] },
    { field: 'unit', headers: ['Unit #', 'Unit'], required: true },
    { field: 'move_in', headers: ['Start Date'] },
    { field: 'move_out', headers: ['End Date'] },
    { field: 'occupants', headers: ['# Occ'], lookup: { null: '0' } },
  ],
  emptyWhen: ['unit'],
};

export const BUILTIN: Layout[] = [AMR_STATUS, UNIT_DIRECTORY];
