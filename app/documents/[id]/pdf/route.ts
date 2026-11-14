import { NextResponse } from 'next/server';
import { getDb } from '@/src/server/db';
import { getSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { getPdf } from '@/src/documents/build';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.mustChangePassword) return new NextResponse('Not allowed.', { status: 403 });
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const audience = q.get('copy') === 'tech' ? 'tech' : 'client';
  // Technicians get the technician copy only, and never see a price.
  if (audience === 'client' && !can(s, 'price.view')) return new NextResponse('Not allowed.', { status: 403 });
  const db = await getDb();
  let version = Number(q.get('v'));
  if (!version) version = (await db.query<{ v: number }>(`SELECT max(version) v FROM document_version WHERE document_id=$1 AND status='issued'`, [id])).rows[0]?.v ?? 0;
  const pdf = version ? await getPdf(db, id, version, audience) : null;
  if (!pdf) return new NextResponse('No issued version.', { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), { headers: {
    'content-type': 'application/pdf', 'cache-control': 'no-store',
    'content-disposition': `inline; filename="${pdf.number}-v${version}-${audience === 'tech' ? 'technician' : 'client'}.pdf"` } });
}
