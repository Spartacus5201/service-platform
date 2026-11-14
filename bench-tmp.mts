import { PGlite } from '@electric-sql/pglite';
import { openDb } from '/home/claude/service-platform/src/db.ts';
let t = Date.now(); const a = await openDb(); console.log('openDb cold', Date.now() - t);
t = Date.now(); await openDb(); console.log('openDb warm', Date.now() - t);
const dump = await a.dumpDataDir('none');
t = Date.now(); const b = new PGlite({ loadDataDir: dump }); await b.waitReady; console.log('load from dump', Date.now() - t, dump.size);
t = Date.now(); const c = new PGlite({ loadDataDir: dump }); await c.waitReady; console.log('load from dump 2', Date.now() - t);
