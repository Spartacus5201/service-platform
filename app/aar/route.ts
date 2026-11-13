// After Action Report PDF: /aar?visit=<id> for one visit, /aar?document=<id> for every visit that worked a WA.
import { NextResponse } from 'next/server';
import { getDb } from '@/src/server/db';
import { getSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { today } from '@/src/server/dates';
import { aarForDocument, aarForVisit } from '@/src/service/aar';
import { renderAarPdf } from '@/src/service/pdf';

export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.mustChangePassword || !can(s.role, 'edit_documents')) return new NextResponse('Not allowed.', { status: 403 });
  const sp = new URL(req.url).searchParams; const visit = sp.get('visit'); const document = sp.get('document');
  const db = await getDb();
  try {
    const a = document ? await aarForDocument(db, document) : visit ? await aarForVisit(db, visit) : null;
    if (!a) return new NextResponse('Say which visit or document.', { status: 400 });
    const name = `${a.property.classId}-${a.document?.number ?? a.visits[0].visitedOn}-after-action`;
    return new NextResponse(Buffer.from(await renderAarPdf(a, today())), { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store', 'content-disposition': `inline; filename="${name}.pdf"` } });
  } catch (e) { return new NextResponse(e instanceof Error ? e.message : 'Not found.', { status: 404 }); }
}
