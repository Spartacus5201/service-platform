// Whole-database backup and restore. A backup is a gzipped copy of the PGlite data directory; restoring loads it into a fresh directory.
import { PGlite } from '@electric-sql/pglite';
import { existsSync, renameSync, readFileSync } from 'node:fs';
import type { Db } from '../db';
import { migrate } from '../db';

export async function backupBytes(db: Db): Promise<Uint8Array> {
  const f = await db.dumpDataDir('gzip');
  return new Uint8Array(await f.arrayBuffer());
}

export const backupName = (date: string) => `service-platform-backup-${date}.tgz`;

/** Load a backup into dataDir (an existing directory is moved aside, never deleted). Returns the number of properties as a sanity check. */
export async function restoreBackup(bytes: Uint8Array, dataDir: string, stamp: string): Promise<{ movedTo: string | null; properties: number }> {
  let movedTo: string | null = null;
  if (existsSync(dataDir)) { movedTo = `${dataDir}.before-restore-${stamp}`; renameSync(dataDir, movedTo); }
  const db = new PGlite(dataDir, { loadDataDir: new Blob([bytes as BlobPart]) });
  await db.waitReady;
  await migrate(db);          // a backup from an older version is brought up to date
  const n = Number((await db.query<{ n: string }>('SELECT count(*)::text n FROM property')).rows[0].n);
  await db.close();
  return { movedTo, properties: n };
}

export const readBackupFile = (p: string) => new Uint8Array(readFileSync(p));
