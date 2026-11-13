import { describe, it, expect } from 'vitest';
import { openDb, migrate } from '../src/db';

describe('schema', () => {
  it('migrates cleanly and is idempotent', async () => {
    const db = await openDb();
    expect(await migrate(db)).toEqual([]);
    const t = await db.query<{ n: string }>(`SELECT count(*)::text n FROM information_schema.tables WHERE table_schema='public'`);
    expect(Number(t.rows[0].n)).toBeGreaterThan(20);
  });

  it('seeds the agreed settings', async () => {
    const db = await openDb();
    const r = await db.query<{ key: string; value: unknown }>(`SELECT key, value FROM setting`);
    const s = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
    expect(s.int_read_threshold).toBe(5);
    expect(s.int_stale_days).toBe(3);
    expect(s.expiring_window_days).toBe(30);
    expect(s.raw_import_retention_days).toBe(180);
  });

  it('blocks invoicing the same event line twice', async () => {
    const db = await openDb();
    const p = await db.query<{ id: string }>(`INSERT INTO property (class_id,name) VALUES ('1','P') RETURNING id`);
    const b = await db.query<{ id: string }>(`INSERT INTO building (property_id,label) VALUES ($1,'1') RETURNING id`, [p.rows[0].id]);
    const u = await db.query<{ id: string }>(`INSERT INTO unit (building_id,current_label) VALUES ($1,'101') RETURNING id`, [b.rows[0].id]);
    const e = await db.query<{ id: string }>(`INSERT INTO endpoint (unit_id,service_code) VALUES ($1,'WS') RETURNING id`, [u.rows[0].id]);
    const v = await db.query<{ id: string }>(`INSERT INTO visit (property_id,visited_on,outcome) VALUES ($1,'2026-11-06','completed') RETURNING id`, [p.rows[0].id]);
    const ev = await db.query<{ id: string }>(`INSERT INTO service_event (visit_id,endpoint_id,action) VALUES ($1,$2,'repair') RETURNING id`, [v.rows[0].id, e.rows[0].id]);
    const s = await db.query<{ id: string }>(`INSERT INTO invoice_submission (property_id,submitted_on) VALUES ($1,'2026-11-06') RETURNING id`, [p.rows[0].id]);
    await db.query(`INSERT INTO invoice_line (submission_id,service_event_id,amount) VALUES ($1,$2,10)`, [s.rows[0].id, ev.rows[0].id]);
    await expect(db.query(`INSERT INTO invoice_line (submission_id,service_event_id,amount) VALUES ($1,$2,10)`, [s.rows[0].id, ev.rows[0].id])).rejects.toThrow();
  });
});
