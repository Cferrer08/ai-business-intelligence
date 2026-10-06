import { z } from "zod";
import { getApiWorkspace } from "@/lib/server/workspace";
import { getReport } from "@/lib/server/reportAccess";
import { factsCsv } from "@/lib/reports/view";
import { safeFilename } from "@/lib/reports/filename";
import type { ReportContent } from "@/lib/server/reports";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiWorkspace("VIEWER");
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  const id = z.string().uuid().safeParse((await params).id);
  const row = id.success ? await getReport(auth.ctx.workspace.id, id.data) : null;
  if (!row || row.report.status !== "ready") return new Response("Report not found.", { status: 404 });
  return new Response("\ufeff" + factsCsv(row.report.content as ReportContent), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safeFilename(row.report.title)}-figures.csv"`, "Cache-Control": "no-store" },
  });
}
