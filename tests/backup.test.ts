import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { backupBytes, restoreBackup } from '../src/admin/backup';

describe('backup', () => {
  it('round-trips the database through a backup file', async () => {
    const db = await openDb();
    await db.query(`INSERT INTO property (class_id,name) VALUES ('9900001','Backup Test')`);
    const bytes = await backupBytes(db);
    const dir = mkdtempSync(join(tmpdir(), 'sp-restore-'));
    try {
      const r = await restoreBackup(bytes, join(dir, 'data'), 'test');
      expect(r.properties).toBe(1);
      expect(r.movedTo).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
