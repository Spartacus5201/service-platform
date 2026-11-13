import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db';
import { backupIfDue } from '../src/admin/autobackup';

describe('automatic daily backup', () => {
  it('writes one backup per day and keeps the newest N', async () => {
    const db = await openDb();
    const dir = mkdtempSync(join(tmpdir(), 'sp-backup-'));
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-03']) writeFileSync(join(dir, `service-platform-backup-${d}.tgz`), 'old');
    expect(await backupIfDue(db, dir, 3, '2026-11-13')).toMatch(/2026-11-13\.tgz$/);
    expect(await backupIfDue(db, dir, 3, '2026-11-13')).toBeNull();          // already done today
    expect(readdirSync(dir).sort()).toEqual(['service-platform-backup-2026-11-02.tgz', 'service-platform-backup-2026-11-03.tgz', 'service-platform-backup-2026-11-13.tgz']);
  }, 60000);
});
