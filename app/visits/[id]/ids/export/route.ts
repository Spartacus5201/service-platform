import { NextResponse } from 'next/server';
import { getDb } from '@/src/server/db';
import { getSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { closeoutData } from '@/src/service/closeout';
import { buildIdUpdate, idUpdateXlsx } from '@/src/service/idupdate';

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.mustChangePassword || !can(s.role, 'edit_documents')) return new NextResponse('Not allowed.', { status: 403 });
  const { id } = await ctx.params;
  const db = await getDb();
  try {
    const c = await closeoutData(db, id);
    await buildIdUpdate(db, id);
    const bytes = await idUpdateXlsx(db, id, { property: c.property.name, classId: c.property.classId, visitedOn: c.visit.visitedOn, technician: c.visit.technician });
    return new NextResponse(Buffer.from(bytes), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${c.property.classId}-${c.visit.visitedOn.replaceAll('-', '').slice(2)}-ID-update.xlsx"` } });
  } catch { return new NextResponse('Not found.', { status: 404 }); }
}
