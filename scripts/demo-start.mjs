// Start the app against the demo database (works on Windows and Linux).
import { spawn } from 'node:child_process';
const p = spawn('npx', ['next', process.argv[2] === 'prod' ? 'start' : 'dev', '-p', '3000'], { stdio: 'inherit', shell: true, env: { ...process.env, DATA_DIR: '.pgdata-demo', SF_MODE: process.env.SF_MODE ?? 'mock', COOKIE_SECURE: process.env.COOKIE_SECURE ?? 'false' } });
p.on('exit', (c) => process.exit(c ?? 0));
