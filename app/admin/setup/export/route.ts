import { NextResponse } from 'next/server';
import { getDb } from '@/src/server/db';
import { getSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { today } from '@/src/server/dates';
import { exportSetup } from '@/src/admin/setup';

export async function GET() {
  const s = await getSession();
  if (!s || s.mustChangePassword || !can(s, 'settings.system')) return new NextResponse('Not allowed.', { status: 403 });
  const db = await getDb();
  const f = await exportSetup(db);
  await db.query(`INSERT INTO audit_log (user_id,action,entity,entity_id,detail) VALUES ($1,'setup_exported','setup',NULL,'{}')`, [s.userId]);
  return new NextResponse(JSON.stringify(f, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="service-platform-setup-${today()}.json"`, 'cache-control': 'no-store' } });
}
