import "server-only";
import { analysisRequests, analysisResults, and, asc, conversations, datasets, db, desc, eq, isNull } from "@insight/database";
import { renderInsight, segmentsToText, type AnalysisSpec, type EngineResult, type Insight, type PreviousTurn } from "@insight/ai";
import type { TurnStatus, TurnView } from "@/lib/analyst/types";

// All queries filter by the workspace taken from the session, never from the request.

export async function listConversations(workspaceId: string, limit = 50) {
  return db
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt, datasetName: datasets.name })
    .from(conversations)
    .innerJoin(datasets, eq(datasets.id, conversations.datasetId))
    .where(and(eq(conversations.workspaceId, workspaceId), isNull(conversations.deletedAt)))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
}

export async function getConversation(workspaceId: string, conversationId: string) {
  const [row] = await db
    .select({ conversation: conversations, dataset: datasets })
    .from(conversations)
    .innerJoin(datasets, eq(datasets.id, conversations.datasetId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId), isNull(conversations.deletedAt)))
    .limit(1);
  return row ?? null;
}

export function toTurn(req: typeof analysisRequests.$inferSelect, res: typeof analysisResults.$inferSelect | null): TurnView {
  const result = (res?.result as EngineResult | undefined) ?? null;
  const insight = (res?.insight as Insight | undefined) ?? null;
  const plan = req.plan as { title?: string; analysis?: AnalysisSpec } | null;
  return {
    requestId: req.id,
    question: req.question,
    status: req.status as TurnStatus,
    title: plan?.title ?? null,
    message: req.errorMessage,
    plan: plan?.analysis ?? null,
    result,
    insight,
    rendered: insight && result ? renderInsight(insight, result.facts) : null,
    insightSource: (res?.insightSource as "model" | "template" | undefined) ?? null,
    createdAt: req.createdAt.toISOString(),
  };
}

export async function getTurns(workspaceId: string, conversationId: string): Promise<TurnView[]> {
  const rows = await db
    .select({ req: analysisRequests, res: analysisResults })
    .from(analysisRequests)
    .leftJoin(analysisResults, eq(analysisResults.requestId, analysisRequests.id))
    .where(and(eq(analysisRequests.conversationId, conversationId), eq(analysisRequests.workspaceId, workspaceId)))
    .orderBy(asc(analysisRequests.createdAt));
  return rows.map((r) => toTurn(r.req, r.res));
}

/** The last few answered turns, given to the planner so follow-ups work. */
export function previousTurns(turns: TurnView[]): PreviousTurn[] {
  return turns
    .filter((t) => t.status === "succeeded" || t.status === "clarification")
    .slice(-3)
    .map((t) => ({ question: t.question, plan: t.plan, headline: t.rendered ? segmentsToText(t.rendered.headline) : t.message }));
}
