# Running Service Platform

## On a Windows laptop (or any computer with Node.js)
1. Install Node.js LTS (20 or newer) from nodejs.org.
2. Download or clone this repository.
3. Double-click `start.cmd` (Windows) or run `./start.sh` (macOS/Linux), or `npm run local`.

The first run installs packages and builds (a few minutes). Later runs start in seconds and rebuild only when the code has changed. The browser opens at http://localhost:3000. On first visit it asks you to create the administrator, using the **setup code printed in the start window** (only whoever started the server can see it); add everyone else under Admin.

- Data: `.pgdata` in the project folder.
- Daily backups: `backups/` (one per day while it runs, newest 14 kept).
- Options (environment variables): `PORT`, `DATA_DIR`, `BACKUP_DIR`, `BACKUP_KEEP`, `APP_TIMEZONE` (default `America/Chicago`; times on screen are shown in it), `COOKIE_SECURE` (`false` on a laptop, https-only elsewhere), `SESSION_SECRET` (optional; otherwise a `.session-key` file is made next to the data folder).
- Security: sign-in is refused for 15 minutes after 8 wrong passwords for one email. Changing a password, an admin reset, or Sign out ends that person's sessions on every device. Backups are written readable by the app's user only; the sign-in key is never in a backup.
- Stop: close the window or press Ctrl+C.

Other people on the same network can use it at `http://<this computer's name>:3000` if the firewall allows it. The laptop must be on and running it.

## On the homelab (Docker)
```
docker compose up -d
```
Serves on port 3000. Everything is kept in `./data` next to `docker-compose.yml`: the database in `data/db`, daily backups in `data/backups`, the sign-in key in `data/.session-key`. The first-run setup code is in `docker compose logs`. Put it behind your reverse proxy for HTTPS (sign-in cookies are https-only by default; for plain http set `COOKIE_SECURE: "false"`).

Update: `git pull && docker compose up -d --build`. The database migrates itself on start.

## Restore a backup
Stop the app, then:
```
npx tsx scripts/restore.ts backups/service-platform-backup-YYYY-MM-DD.tgz
```
The current database is moved aside first, not deleted. It restores into `.pgdata` unless `DATA_DIR` says otherwise (Docker: stop the container and run it from a checkout with `DATA_DIR=data/db`).

## Demo
`npm run demo` then `npm run demo:start` (separate demo database; see DEMO.md).

## Moving to the company server
The Dockerfile is the starting point for IT. What changes there: a managed Postgres instead of the built-in database, company sign-in (SSO), HTTPS, and backups handled by IT. See IT-QUESTIONS.md.
