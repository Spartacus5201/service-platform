// Build the demo database. Usage: npm run demo   (writes .pgdata-demo; start with npm run demo:start)
import { rmSync } from 'node:fs';
import { openDb } from '../src/db';
import { buildDemo, DEMO_LOGIN } from '../src/dev/demo';

const dir = '.pgdata-demo';
rmSync(dir, { recursive: true, force: true });
const db = await openDb(dir);
const r = await buildDemo(db);
await db.close();
console.log(`Demo database built in ${dir}: ${r.properties} properties.\nStart it with:  npm run demo:start\nThen sign in as ${DEMO_LOGIN.email} / ${DEMO_LOGIN.password}`);
