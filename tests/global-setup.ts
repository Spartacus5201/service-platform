// Build the migrated database once per test run; each test then loads this copy (~0.4 s) instead of starting
// PGlite and running every migration (~2 s). The file is rebuilt every run, so it always matches the migrations.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb, TEST_TEMPLATE } from '../src/db';

export default async function setup() {
  const db = await openDb(undefined, { template: false });
  const dump = await db.dumpDataDir('none');
  mkdirSync(dirname(TEST_TEMPLATE), { recursive: true });
  writeFileSync(TEST_TEMPLATE, new Uint8Array(await dump.arrayBuffer()));
  await db.close();
}
