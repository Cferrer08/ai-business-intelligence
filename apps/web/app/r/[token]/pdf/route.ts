import { getSharedReport } from "@/lib/server/reportAccess";
import { renderReportPdf } from "@/lib/server/engine";
import { pdfPayload } from "@/lib/reports/view";
import { safeFilename } from "@/lib/reports/filename";
import { createRateLimiter } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!limiter(`sharepdf:${ip}`).allowed) return new Response("Too many requests.", { status: 429 });
  const row = await getSharedReport((await params).token);
  if (!row) return new Response("This link isn't valid or has been turned off.", { status: 404 });
  try {
    const pdf = await renderReportPdf(pdfPayload(row.report.title, row.content, row.author ?? "InsightAI"));
    return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeFilename(row.report.title)}.pdf"`, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch {
    return new Response("The PDF couldn't be created right now.", { status: 503 });
  }
}
