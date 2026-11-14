import { PGlite } from '@electric-sql/pglite';
import { appTimeZone } from './timezone';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export type Db = PGlite;

function findMigrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    join(process.cwd(), 'db', 'migrations'),
    join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'),
  ].filter((x): x is string => !!x);
  const hit = candidates.find((c) => existsSync(c));
  if (!hit) throw new Error(`Migrations folder not found. Looked in: ${candidates.join(', ')}`);
  return hit;
}

/** Tests only: a migrated empty database built once per run by tests/global-setup.ts. */
export const TEST_TEMPLATE = join(process.cwd(), 'node_modules', '.cache', 'service-platform', 'test-template.tar');
let template: Blob | null = null;

/** Open a database. No dataDir = in-memory. A path = persisted on disk (local dev). */
export async function openDb(dataDir?: string, o: { template?: boolean } = {}): Promise<Db> {
  if (dataDir && !dataDir.includes('://')) mkdirSync(dirname(resolve(dataDir)), { recursive: true });   // e.g. DATA_DIR=data/db on a fresh machine
  if (!dataDir && process.env.VITEST && o.template !== false && existsSync(TEST_TEMPLATE)) {
    template ??= new Blob([readFileSync(TEST_TEMPLATE)]);
    const t = new PGlite({ loadDataDir: template });
    await t.waitReady;
    await setTimeZone(t);
    await migrate(t);
    return t;
  }
  const db = new PGlite(dataDir);
  await db.waitReady;
  await setTimeZone(db);
  await migrate(db);
  return db;
}

/** current_date and timestamp-to-date casts in SQL follow the office's time zone, like today() does. */
async function setTimeZone(db: Db) {
  await db.query(`SELECT set_config('TimeZone', $1, false)`, [appTimeZone()]);
}

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const migrationsDir = findMigrationsDir();
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    applied.push(file);
  }
  return applied;
}
