// One database per server process. PGlite is single-process, so the handle is cached on globalThis (survives dev reloads).
import { openDb, type Db } from '../db';

const g = globalThis as unknown as { __spDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  g.__spDb ??= openDb(process.env.DATA_DIR ?? '.pgdata');
  return g.__spDb;
}
