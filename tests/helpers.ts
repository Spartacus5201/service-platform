import { openDb, type Db } from '../src/db';
import { importParsed } from '../src/import/commit';
import { parseAutoAudit } from '../src/parsers/audit';
import { parsePsr } from '../src/parsers/psr';
import { autoAuditGrid, psrSheets, CLASS_ID } from './fixtures';

export interface World { db: Db; pid: string; batchId: string; ep: (unit: string) => Promise<string> }

/** A property with the six fixture units imported from an Auto Audit; optionally installed by us (PSR, completed 2026-03-12). */
export async function world(opts: { installedByUs?: boolean } = {}): Promise<World> {
  const db = await openDb();
  const pid = (await db.query<{ id: string }>(`INSERT INTO property (class_id,name,address) VALUES ($1,'Test Property','1 Test Road') RETURNING id`, [CLASS_ID])).rows[0].id;
  if (opts.installedByUs) await importParsed(db, pid, parsePsr(psrSheets()), { createMissing: true });
  const r = await importParsed(db, pid, parseAutoAudit(autoAuditGrid()), { createMissing: true });
  const ep = async (unit: string) =>
    (await db.query<{ id: string }>(`SELECT e.id FROM endpoint e JOIN unit u ON u.id=e.unit_id WHERE ltrim(u.current_label,'0')=$1`, [unit])).rows[0].id;
  return { db, pid, batchId: r.batchId!, ep };
}

export const count = async (db: Db, sql: string, p: unknown[] = []) => Number((await db.query<{ n: string }>(sql, p)).rows[0].n);
