// Automatic daily backup for a server left running (laptop, homelab, container).
// Turned on by BACKUP_DIR. Writes one backup per day and keeps the newest BACKUP_KEEP (default 14).
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db';
import { todayIn } from '../timezone';
import { backupBytes, backupName } from './backup';

const localDate = () => todayIn();          // the office's day, not the server clock's

/** Write today's backup if it is not there yet, then remove the oldest beyond `keep`. Returns the file written, if any. */
export async function backupIfDue(db: Db, dir: string, keep = 14, date = localDate()): Promise<string | null> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, backupName(date));
  let wrote: string | null = null;
  if (!existsSync(file)) { writeFileSync(file, await backupBytes(db), { mode: 0o600 }); wrote = file; }   // owner-only: a backup holds all the data
  const all = readdirSync(dir).filter((f) => /^service-platform-backup-\d{4}-\d{2}-\d{2}\.tgz$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - keep))) rmSync(join(dir, f));
  return wrote;
}

/** Check once at start and then every hour; a backup is written the first time each day. */
export function startAutoBackup(getDb: () => Promise<Db>, dir: string, keep: number): void {
  const run = async () => {
    try { const f = await backupIfDue(await getDb(), dir, keep); if (f) console.log(`[backup] wrote ${f}`); }
    catch (e) { console.error('[backup] failed:', e instanceof Error ? e.message : e); }
  };
  void run();
  setInterval(run, 60 * 60 * 1000).unref();
}
