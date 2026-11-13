// Create or reset login users from a LOCAL credentials file (never commit it).
// Usage: npm run users -- ./credentials.md [--data .pgdata]
// File format: a markdown table with columns  email | name | role | temporary password
// Users must change the temporary password at first sign-in.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from '../src/db';
import { createUser, parseCredentialsMd } from '../src/auth/auth';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dataIdx = args.indexOf('--data');
const dataDir = dataIdx >= 0 ? args[dataIdx + 1] : process.env.PGDATA_DIR;
if (!file) { console.error('Usage: npm run users -- <credentials.md> [--data <dir>]'); process.exit(1); }

if (!existsSync(file)) {
  console.error(`\nNo file at ${file}.\nCreate it as a markdown table (copy users.example.md), for example:\n\n| email | name | role | temporary password |\n|---|---|---|---|\n| you@example.com | Your Name | admin | Temp-Pass-1234 |\n\nRoles: admin, office, coordinator, technician. Then run this command again.\n`);
  process.exit(1);
}
let users: ReturnType<typeof parseCredentialsMd>;
try { users = parseCredentialsMd(readFileSync(file, 'utf8'), (l) => console.warn(`Skipped (not in the form  email | name | role | password):  ${l}`)); } catch (e) { console.error(`\n${(e as Error).message}\n\nFix ${file} and run again. See users.example.md.\n`); process.exit(1); }
if (!users.length) {
  console.error(`\nNo users found in ${file}. Each user needs one line like:\n\n| you@example.com | Your Name | admin | Temp-Pass-1234 |\n\n(email | name | role | temporary password; the email must contain @.)\n`);
  process.exit(1);
}
const db = await openDb(dataDir);
for (const u of users) { await createUser(db, { ...u, mustChangePassword: true }); console.log(`ok  ${u.email}  (${u.role})`); }
const total = (await db.query<{ n: string }>('SELECT count(*) n FROM app_user')).rows[0].n;
console.log(dataDir ? `${users.length} user(s) written. ${total} user(s) now in ${resolve(dataDir)}` : `${users.length} user(s) written to a TEMPORARY in-memory database: nothing is saved. Add  --data .pgdata`);
await db.close();
