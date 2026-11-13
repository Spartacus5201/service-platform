import { PGlite } from '@electric-sql/pglite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

/** Open a database. No dataDir = in-memory. A path = persisted on disk (local dev). */
export async function openDb(dataDir?: string): Promise<Db> {
  const db = new PGlite(dataDir);
  await db.waitReady;
  await migrate(db);
  return db;
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
