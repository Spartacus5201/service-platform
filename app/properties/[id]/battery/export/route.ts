import { NextResponse } from 'next/server';
import { getDb } from '@/src/server/db';
import { getSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { today } from '@/src/server/dates';
import { getProperty } from '@/src/server/queries';
import { lowBatteryReport, lowBatteryXlsx } from '@/src/service/battery';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.mustChangePassword || !can(s.role, 'edit_documents')) return new NextResponse('Not allowed.', { status: 403 });
  const { id } = await ctx.params; const db = await getDb();
  const p = await getProperty(db, id); if (!p) return new NextResponse('Not found.', { status: 404 });
  const bytes = await lowBatteryXlsx(await lowBatteryReport(db, id, today()), { name: p.name, classId: p.class_id }, today());
  return new NextResponse(Buffer.from(bytes), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${p.class_id}-low-battery-${today()}.xlsx"` } });
}
