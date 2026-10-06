import { z } from "zod";
import { getApiWorkspace } from "@/lib/server/workspace";
import { getReport } from "@/lib/server/reportAccess";
import { renderReportPdf } from "@/lib/server/engine";
import { pdfPayload } from "@/lib/reports/view";
import { safeFilename } from "@/lib/reports/filename";
import type { ReportContent } from "@/lib/server/reports";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getApiWorkspace("VIEWER");
  if (!auth.ok) return new Response(auth.message, { status: auth.status });
  const id = z.string().uuid().safeParse((await params).id);
  const row = id.success ? await getReport(auth.ctx.workspace.id, id.data) : null;
  if (!row || row.report.status !== "ready") return new Response("Report not found.", { status: 404 });
  try {
    const pdf = await renderReportPdf(pdfPayload(row.report.title, row.report.content as ReportContent, row.author ?? "InsightAI"));
    return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeFilename(row.report.title)}.pdf"`, "Cache-Control": "no-store" } });
  } catch {
    return new Response("The PDF couldn't be created because the data engine isn't reachable.", { status: 503 });
  }
}
