// Runs once when the server starts: prints a setup code on first run, and turns on the daily backup when BACKUP_DIR is set.
// The NEXT_RUNTIME check must wrap the imports directly so the bundler leaves them out of the edge build.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // First run: print a fresh setup code so only whoever started the server can create the first admin.
    const { issueSetupCode } = await import('./src/auth/setup');
    const { getDb: db0 } = await import('./src/server/db');
    try { await issueSetupCode(await db0()); } catch (e) { console.error('[setup]', e); }
    if (!process.env.BACKUP_DIR) return;
    const { startAutoBackup } = await import('./src/admin/autobackup');
    const { getDb } = await import('./src/server/db');
    startAutoBackup(getDb, process.env.BACKUP_DIR, Number(process.env.BACKUP_KEEP ?? 14) || 14);
  }
}
