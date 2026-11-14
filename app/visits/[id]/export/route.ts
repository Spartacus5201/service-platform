import { NextResponse } from 'next/server';
import { getDb } from '@/src/server/db';
import { getSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { closeoutData, invoiceSheet } from '@/src/service/closeout';
import { renderInvoicePdf, renderNotesPdf, type PhotoFile } from '@/src/service/pdf';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.mustChangePassword) return new NextResponse('Not allowed.', { status: 403 });
  const { id } = await ctx.params;
  const kind = new URL(req.url).searchParams.get('kind') === 'invoice' ? 'invoice' : 'notes';
  if (!can(s, kind === 'invoice' ? 'invoice.manage' : 'job.view')) return new NextResponse('Not allowed.', { status: 403 });
  const db = await getDb();
  try {
    const c = await closeoutData(db, id);
    const name = `${c.property.classId}-${c.visit.visitedOn.replaceAll('-', '').slice(2)}`;
    let bytes: Uint8Array;
    if (kind === 'invoice') bytes = await renderInvoicePdf(await invoiceSheet(db, id));
    else {
      const rows = (await db.query<{ endpoint_id: string | null; caption: string | null; mime: string; bytes: Uint8Array }>(
        `SELECT endpoint_id, caption, mime, bytes FROM visit_photo WHERE visit_id=$1 AND include_in_client ORDER BY created_at`, [id])).rows;
      const where = new Map(c.units.map((u) => [u.endpointId, `${u.building}-${u.unit}`]));
      const photos: PhotoFile[] = rows.map((r) => ({ caption: r.caption, where: r.endpoint_id ? where.get(r.endpoint_id) ?? '' : '', mime: r.mime, bytes: r.bytes }));
      bytes = await renderNotesPdf(c, photos);
    }
    return new NextResponse(Buffer.from(bytes), { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store',
      'content-disposition': `inline; filename="${name}-${kind === 'invoice' ? 'invoicing-INTERNAL' : 'service-notes'}.pdf"` } });
  } catch { return new NextResponse('Not found.', { status: 404 }); }
}
