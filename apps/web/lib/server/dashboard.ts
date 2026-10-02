import "server-only";
import { analysisRequests, analysisResults, and, charts, conversations, datasetColumns, datasets, db, desc, eq, inArray, isNull } from "@insight/database";
import type { AnalysisSpec, EngineResult } from "@insight/ai";
import { renderInsight, segmentsToText, type Insight } from "@insight/ai";

/** Ready datasets that have both a date column and a money/quantity column, newest first. */
export async function dashboardDatasets(workspaceId: string) {
  const ready = await db
    .select({ id: datasets.id, name: datasets.name, createdAt: datasets.createdAt })
    .from(datasets)
    .where(and(eq(datasets.workspaceId, workspaceId), eq(datasets.status, "ready"), isNull(datasets.deletedAt)))
    .orderBy(desc(datasets.createdAt));
  if (!ready.length) return [];
  const roles = await db
    .select({ datasetId: datasetColumns.datasetId, role: datasetColumns.semanticRole })
    .from(datasetColumns)
    .where(and(eq(datasetColumns.workspaceId, workspaceId), inArray(datasetColumns.datasetId, ready.map((d) => d.id))));
  return ready.filter((d) => {
    const r = new Set(roles.filter((x) => x.datasetId === d.id).map((x) => x.role));
    return r.has("time") && (r.has("monetary") || r.has("quantity"));
  });
}

export async function pinnedCharts(workspaceId: string) {
  const rows = await db
    .select({ chart: charts, result: analysisResults.result, plan: analysisRequests.plan, conversationId: analysisRequests.conversationId, analysedAt: analysisRequests.createdAt })
    .from(charts)
    .innerJoin(analysisResults, eq(analysisResults.id, charts.analysisResultId))
    .innerJoin(analysisRequests, eq(analysisRequests.id, analysisResults.requestId))
    .innerJoin(conversations, eq(conversations.id, analysisRequests.conversationId))
    .where(and(eq(charts.workspaceId, workspaceId), isNull(conversations.deletedAt)))
    .orderBy(desc(charts.createdAt))
    .limit(12);
  return rows.map((r) => ({
    id: r.chart.id,
    title: r.chart.title,
    chartType: r.chart.chartType,
    topN: (r.chart.config as { topN?: number | null }).topN ?? null,
    result: r.result as EngineResult,
    plan: (r.plan as { analysis?: AnalysisSpec } | null)?.analysis ?? null,
    conversationId: r.conversationId,
    analysedAt: r.analysedAt.toISOString(),
  }));
}

export async function recentAnalyses(workspaceId: string, limit = 5) {
  const rows = await db
    .select({ req: analysisRequests, res: analysisResults, datasetName: datasets.name })
    .from(analysisRequests)
    .innerJoin(analysisResults, eq(analysisResults.requestId, analysisRequests.id))
    .innerJoin(datasets, eq(datasets.id, analysisRequests.datasetId))
    .innerJoin(conversations, eq(conversations.id, analysisRequests.conversationId))
    .where(and(eq(analysisRequests.workspaceId, workspaceId), eq(analysisRequests.status, "succeeded"), isNull(conversations.deletedAt)))
    .orderBy(desc(analysisRequests.createdAt))
    .limit(limit);
  return rows.map((r) => {
    const result = r.res.result as EngineResult;
    const insight = r.res.insight as Insight;
    return {
      id: r.req.id,
      conversationId: r.req.conversationId,
      question: r.req.question,
      datasetName: r.datasetName,
      createdAt: r.req.createdAt.toISOString(),
      summary: segmentsToText(renderInsight(insight, result.facts).headline),
      result,
      plan: (r.req.plan as { analysis?: AnalysisSpec } | null)?.analysis ?? null,
    };
  });
}
