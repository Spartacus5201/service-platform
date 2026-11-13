// Diagnose a sign-in problem. Stop the app first (Ctrl+C): the database folder can only be opened by one program at a time.
// Usage: npm run check-login -- --data .pgdata you@example.com "the password you are typing"
import { resolve } from 'node:path';
import { openDb } from '../src/db';
import { verifyPassword } from '../src/auth/auth';

const args = process.argv.slice(2);
const di = args.indexOf('--data');
const dataDir = di >= 0 ? args[di + 1] : process.env.DATA_DIR ?? '.pgdata';
const rest = args.filter((a, i) => !a.startsWith('--') && i !== di + 1);
const [email, password] = rest;

console.log(`Database folder: ${resolve(dataDir)}`);
const db = await openDb(dataDir);
const users = (await db.query<{ id: string; email: string; role: string; active: boolean; must_change_password: boolean; password_hash: string }>(
  `SELECT id,email,role,active,must_change_password,password_hash FROM app_user ORDER BY email`)).rows;
console.log(`${users.length} user(s) in this database:`);
for (const u of users) console.log(`  ${u.email}  role=${u.role}  ${u.active ? 'active' : 'INACTIVE'}  ${u.must_change_password ? 'must change password' : 'password already changed'}`);
if (email) {
  const u = users.find((x) => x.email === email.trim().toLowerCase());
  if (!u) console.log(`\n"${email}" is not in this database. Check the spelling, or run  npm run users -- ./credentials.md --data ${dataDir}`);
  else if (!u.active) console.log(`\n${u.email} exists but is INACTIVE (an admin must reactivate it).`);
  else if (password === undefined) console.log(`\n${u.email} exists and is active. Pass the password as the next argument to test it.`);
  else console.log(`\n${u.email}: password ${(await verifyPassword(password, u.password_hash)) ? 'MATCHES' : 'does NOT match'}. (You typed ${password.length} characters.)`);
}
await db.close();
