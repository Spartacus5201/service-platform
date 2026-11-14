// Runs once when the server starts. Turns on the automatic daily backup when BACKUP_DIR is set.
// The NEXT_RUNTIME check must wrap the imports directly so the bundler leaves them out of the edge build.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (!process.env.BACKUP_DIR) return;
    const { startAutoBackup } = await import('./src/admin/autobackup');
    const { getDb } = await import('./src/server/db');
    startAutoBackup(getDb, process.env.BACKUP_DIR, Number(process.env.BACKUP_KEEP ?? 14) || 14);
  }
}
