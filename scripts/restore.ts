// Restore a backup. Stop the app first.  Usage: npx tsx scripts/restore.ts <backup.tgz>   (DATA_DIR defaults to .pgdata)
import { restoreBackup, readBackupFile } from '../src/admin/backup';
const file = process.argv[2];
if (!file) { console.error('Usage: npx tsx scripts/restore.ts <backup.tgz>'); process.exit(1); }
restoreBackup(readBackupFile(file), process.env.DATA_DIR ?? '.pgdata', new Date().toISOString().replace(/\D/g, '').slice(0, 14))
  .then((r) => console.log(`Restored ${r.properties} properties.` + (r.movedTo ? ` Previous data kept at ${r.movedTo}.` : '')))
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
