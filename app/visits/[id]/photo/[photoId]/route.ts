import { NextResponse } from 'next/server';
import { getDb } from '@/src/server/db';
import { getSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';

export async function GET(_: Request, ctx: { params: Promise<{ id: string; photoId: string }> }) {
  const s = await getSession();
  if (!s || s.mustChangePassword || !can(s, 'job.view')) return new NextResponse('Not allowed.', { status: 403 });
  const { id, photoId } = await ctx.params;
  const r = (await (await getDb()).query<{ mime: string; bytes: Uint8Array }>(`SELECT mime, bytes FROM visit_photo WHERE id=$1 AND visit_id=$2`, [photoId, id])).rows[0];
  if (!r) return new NextResponse('Not found.', { status: 404 });
  return new NextResponse(Buffer.from(r.bytes), { headers: { 'content-type': r.mime, 'cache-control': 'private, max-age=300' } });
}
