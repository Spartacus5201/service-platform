import { NextResponse } from 'next/server';
import { getDb } from '@/src/server/db';
import { getSession } from '@/src/server/session';
import { can } from '@/src/auth/auth';
import { today } from '@/src/server/dates';
import { auditLines } from '@/src/queries/audit';
import { auditReportData, renderAuditPdf } from '@/src/review/auditreport';
import { auditCsv, auditXlsx, caseZip } from '@/src/review/export';

export async function GET(req: Request, ctx: { params: Promise<{ id: string; batchId: string }> }) {
  const s = await getSession();
  if (!s || s.mustChangePassword || !can(s.role, 'edit_documents')) return new NextResponse('Not allowed.', { status: 403 });
  const { id, batchId } = await ctx.params;
  const db = await getDb();
  const owns = await db.query(`SELECT 1 FROM import_batch WHERE id=$1 AND property_id=$2`, [batchId, id]);
  if (!owns.rows.length) return new NextResponse('Not found.', { status: 404 });
  const lines = await auditLines(db, batchId, today());
  const format = new URL(req.url).searchParams.get('format') ?? 'csv';
  const cls = (await db.query<{ class_id: string }>(`SELECT class_id FROM property WHERE id=$1`, [id])).rows[0].class_id;
  const base = `audit-${cls}-${today()}`;
  const send = (body: BodyInit, type: string, file: string) => new NextResponse(body, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${file}"`, 'cache-control': 'no-store' } });
  if (format === 'xlsx') return send(Buffer.from(await auditXlsx(lines, `Audit ${cls} ${today()}`)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${base}.xlsx`);
  if (format === 'pdf') return send(Buffer.from(await renderAuditPdf(await auditReportData(db, batchId, lines))), 'application/pdf', `${base}.pdf`);
  if (format === 'case') {
    try { const c = await caseZip(db, batchId, lines); return send(Buffer.from(c.bytes), 'application/zip', `${c.name}.zip`); }
    catch (e) { return new NextResponse(e instanceof Error ? e.message : 'Could not build the case.', { status: 409 }); }
  }
  return send(auditCsv(lines), 'text/csv; charset=utf-8', `${base}.csv`);
}
