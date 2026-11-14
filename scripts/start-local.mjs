// One command to run Service Platform on this computer (Windows, macOS, Linux):
//   installs packages the first time, builds when the code has changed, starts the server,
//   turns on the daily backup, and opens the browser.
// Options (environment variables): PORT (3000), DATA_DIR (.pgdata), BACKUP_DIR (backups), BACKUP_KEEP (14).
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'inherit', shell: win }); if (r.status !== 0) process.exit(r.status ?? 1); };

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) { console.error(`Node.js 20 or newer is needed (this is ${process.versions.node}). Install the LTS version from nodejs.org.`); process.exit(1); }

if (!existsSync('node_modules')) { console.log('Installing packages (first run only)...'); run(npm, ['ci']); }

const newest = (dir) => { let t = 0; if (!existsSync(dir)) return 0; for (const f of readdirSync(dir, { withFileTypes: true })) {
  const p = join(dir, f.name); t = Math.max(t, f.isDirectory() ? newest(p) : statSync(p).mtimeMs); } return t; };
const built = existsSync('.next/BUILD_ID') ? statSync('.next/BUILD_ID').mtimeMs : 0;
const changed = Math.max(newest('app'), newest('src'), newest('db'), statSync('package.json').mtimeMs);
if (!built || changed > built) { console.log('Building (only when the code has changed)...'); run(npm, ['run', 'build']); }

const port = process.env.PORT ?? '3000';
// A laptop serves plain http, so its sign-in cookie cannot be https-only (servers behind HTTPS keep the secure default).
const env = { ...process.env, DATA_DIR: process.env.DATA_DIR ?? '.pgdata', BACKUP_DIR: process.env.BACKUP_DIR ?? 'backups', COOKIE_SECURE: process.env.COOKIE_SECURE ?? 'false' };
console.log(`\nService Platform: http://localhost:${port}\nData: ${env.DATA_DIR}   Daily backups: ${env.BACKUP_DIR}\nClose this window (or press Ctrl+C) to stop.\n`);
const server = spawn(win ? 'npx.cmd' : 'npx', ['next', 'start', '-p', port], { stdio: 'inherit', env, shell: win });
setTimeout(() => {
  const url = `http://localhost:${port}`;
  const opener = win ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* no browser: fine */ }
}, 4000);
server.on('exit', (c) => process.exit(c ?? 0));
