// First run: the first administrator. Until one exists, /setup needs a one-time setup code that is printed in the
// server's console (the window or log of whoever started it), so nobody else on the network can claim the app first.
import { UserError } from '../errors';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db';
import { createUser } from './auth';

export class SetupDoneError extends UserError {}
export class SetupError extends UserError {}

const hash = (code: string) => createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
const users = async (q: Pick<Db, 'query'>) => Number((await q.query<{ n: string }>(`SELECT count(*) n FROM app_user`)).rows[0].n);

/** While no user exists: make a new setup code, store only its hash, and print it to the server console. */
export async function issueSetupCode(db: Db, print: (s: string) => void = console.log): Promise<string | null> {
  if (await users(db)) return null;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
  await db.query(`INSERT INTO setting (key,value) VALUES ('setup_code_hash',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(hash(code))]);
  print(`\n  First-time setup: open /setup and enter this setup code: ${code}\n`);
  return code;
}

export async function hasSetupCode(db: Db): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM setting WHERE key='setup_code_hash'`)).rows.length > 0;
}

/** Create the first administrator: refused once any user exists, and without the right setup code. One transaction. */
export async function createFirstAdmin(db: Db, code: string, u: { email: string; name: string; password: string }): Promise<string> {
  return db.transaction(async (tx) => {
    if (await users(tx)) throw new SetupDoneError('Setup is already done.');
    const stored = (await tx.query<{ value: unknown }>(`SELECT value FROM setting WHERE key='setup_code_hash'`)).rows[0]?.value;
    const given = hash(code);
    if (typeof stored !== 'string' || stored.length !== given.length || !timingSafeEqual(Buffer.from(stored), Buffer.from(given)))
      throw new SetupError('That setup code is not right. It is shown in the window (or log) where the server was started.');
    const id = await createUser(tx, { email: u.email, name: u.name, role: 'admin', password: u.password, mustChangePassword: false });
    await tx.query(`DELETE FROM setting WHERE key='setup_code_hash'`);
    return id;
  });
}
