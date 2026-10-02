"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { analysisRequests, analysisResults, and, charts, db, eq } from "@insight/database";
import { requireWorkspace } from "@/lib/server/workspace";
import type { ActionResult } from "@insight/types";

const TYPES = ["line", "bar", "donut", "scatter", "histogram", "diverging", "kpi", "table"] as const;
const pinSchema = z.object({
  resultId: z.string().uuid(),
  chartType: z.enum(TYPES),
  topN: z.union([z.literal(5), z.literal(10)]).nullable(),
});

export async function pinChart(input: { resultId: string; chartType: string; topN: number | null }): Promise<ActionResult> {
  const { session, workspace } = await requireWorkspace("MEMBER");
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That chart can't be pinned." };
  // The result must belong to this workspace.
  const [row] = await db
    .select({ id: analysisResults.id, question: analysisRequests.question, plan: analysisRequests.plan })
    .from(analysisResults)
    .innerJoin(analysisRequests, eq(analysisRequests.id, analysisResults.requestId))
    .where(and(eq(analysisResults.id, parsed.data.resultId), eq(analysisResults.workspaceId, workspace.id)))
    .limit(1);
  if (!row) return { ok: false, error: "Analysis not found." };
  const title = ((row.plan as { title?: string } | null)?.title ?? row.question).slice(0, 160);
  await db
    .insert(charts)
    .values({ workspaceId: workspace.id, analysisResultId: row.id, createdById: session.user.id, title, chartType: parsed.data.chartType, config: { topN: parsed.data.topN } })
    .onConflictDoUpdate({ target: [charts.workspaceId, charts.analysisResultId], set: { chartType: parsed.data.chartType, config: { topN: parsed.data.topN }, updatedAt: new Date() } });
  revalidatePath("/dashboard");
  return { ok: true, data: undefined };
}

export async function unpinChart(form: FormData) {
  const { workspace } = await requireWorkspace("MEMBER");
  const id = z.string().uuid().safeParse(form.get("chartId"));
  if (!id.success) return;
  await db.delete(charts).where(and(eq(charts.id, id.data), eq(charts.workspaceId, workspace.id)));
  revalidatePath("/dashboard");
}
