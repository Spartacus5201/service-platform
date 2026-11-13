import { NextResponse } from 'next/server';
import { getDb } from '@/src/server/db';
import { getSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { today } from '@/src/server/dates';
import { backupBytes, backupName } from '@/src/admin/backup';

export async function GET() {
  const s = await getSession();
  if (!s || s.mustChangePassword || !can(s.role, 'manage_users')) return new NextResponse('Not allowed.', { status: 403 });
  const bytes = await backupBytes(await getDb());
  return new NextResponse(Buffer.from(bytes), { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${backupName(today())}"`, 'cache-control': 'no-store' } });
}
