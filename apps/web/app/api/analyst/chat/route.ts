import { z } from "zod";
import { analysisRequests, analysisResults, and, conversations, datasets, db, eq, isNull, messages } from "@insight/database";
import { runAnalyst, segmentsToText } from "@insight/ai";
import { getApiWorkspace } from "@/lib/server/workspace";
import { getDatasetProfile } from "@/lib/server/datasets";
import { getConversation, getTurns, previousTurns, toTurn } from "@/lib/server/analyst";
import { analyzeDataset } from "@/lib/server/engine";
import { getLlm, recordAiUsage } from "@/lib/server/ai";
import { knowledgeConfigured, retrievePassages, workspaceHasDocuments } from "@/lib/server/knowledge";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { errorFields, logger } from "@/lib/server/logger";
import type { StreamEvent } from "@/lib/analyst/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Protects AI spend until plan-based monthly limits arrive with billing (Phase 9).
const analysisLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });

const bodySchema = z.object({
  question: z.string().trim().min(3, "Ask a longer question.").max(1000, "Keep questions under 1,000 characters."),
  datasetId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

const json = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  const auth = await getApiWorkspace("MEMBER");
  if (!auth.ok) return json(auth.status, auth.message);
  const { session, workspace } = auth.ctx;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  const { question } = parsed.data;

  const llm = getLlm();
  if (!llm) return json(503, "The AI analyst isn't configured. Add OPENAI_API_KEY to apps/web/.env.local and restart the app.");
  if (!analysisLimiter(`analysis:${session.user.id}`).allowed) return json(429, "You've asked a lot of questions in a short time. Wait a few minutes and try again.");

  // Resolve the conversation and dataset inside this workspace only.
  let conversationId = parsed.data.conversationId;
  let datasetId = parsed.data.datasetId;
  if (conversationId) {
    const conv = await getConversation(workspace.id, conversationId);
    if (!conv) return json(404, "Conversation not found.");
    datasetId = conv.dataset.id;
  }
  if (!datasetId) return json(400, "Choose a dataset first.");
  const [dataset] = await db.select().from(datasets)
    .where(and(eq(datasets.id, datasetId), eq(datasets.workspaceId, workspace.id), isNull(datasets.deletedAt))).limit(1);
  if (!dataset) return json(404, "Dataset not found.");
  if (dataset.status !== "ready") return json(409, "This dataset isn't ready for analysis.");
  const stored = await getDatasetProfile(workspace.id, dataset.id);
  if (!stored) return json(409, "This dataset has no profile yet.");

  if (!conversationId) {
    const [conv] = await db.insert(conversations)
      .values({ workspaceId: workspace.id, datasetId: dataset.id, userId: session.user.id, title: question.slice(0, 160) })
      .returning({ id: conversations.id });
    conversationId = conv.id;
  }
  const previous = previousTurns(await getTurns(workspace.id, conversationId));
  const [request] = await db.insert(analysisRequests)
    .values({ workspaceId: workspace.id, conversationId, datasetId: dataset.id, userId: session.user.id, question })
    .returning();
  await db.insert(messages).values({ conversationId, workspaceId: workspace.id, role: "user", content: question, analysisRequestId: request.id });

  const columns = stored.profile.columns.map((c) => ({ name: c.name, logical_type: c.logical_type, role: c.role.role, concept: c.role.concept }));
  const useDocuments = knowledgeConfigured().ok && (await workspaceHasDocuments(workspace.id));
  const started = Date.now();
  const encoder = new TextEncoder();
  const convId = conversationId;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(e) + "\n")); } catch { /* client went away; keep working and saving */ }
      };
      send({ type: "started", conversationId: convId, requestId: request.id });
      let planTitle: string | null = null;
      try {
        const outcome = await runAnalyst(
          { question, datasetName: dataset.name, profile: stored.profile, previous },
          {
            llm,
            execute: (spec) => analyzeDataset(workspace.id, dataset.id, spec, columns),
            retrieve: useDocuments ? (q) => retrievePassages(workspace.id, session.user.id, q) : undefined,
            onEvent: (e) => { if (e.type === "plan") planTitle = e.title; send(e); },
            onUsage: (purpose, usage, ok, errorCode) =>
              recordAiUsage({ workspaceId: workspace.id, userId: session.user.id, analysisRequestId: request.id, purpose, model: llm.model, usage, succeeded: ok, errorCode }),
          },
        );
        const durationMs = Date.now() - started;
        const scope = and(eq(analysisRequests.id, request.id), eq(analysisRequests.workspaceId, workspace.id));
        let assistantText: string;
        if (outcome.status === "succeeded") {
          const [updated] = await db.update(analysisRequests)
            .set({ status: "succeeded", plan: { title: outcome.title, analysis: outcome.plan }, durationMs }).where(scope).returning();
          const [res] = await db.insert(analysisResults)
            .values({ requestId: request.id, workspaceId: workspace.id, result: outcome.result, insight: outcome.insight, insightSource: outcome.insightSource })
            .returning();
          assistantText = segmentsToText(outcome.rendered.headline);
          send({ type: "done", turn: toTurn(updated, res, false) });
        } else {
          const status = outcome.status;
          const [updated] = await db.update(analysisRequests)
            .set({
              status, durationMs,
              plan: "plan" in outcome && outcome.plan ? { title: planTitle, analysis: outcome.plan } : outcome.status !== "failed" ? { title: outcome.title } : null,
              errorCode: outcome.status === "failed" ? outcome.code : null,
              errorMessage: outcome.message.slice(0, 500),
            }).where(scope).returning();
          assistantText = outcome.message;
          send({ type: "done", turn: toTurn(updated, null) });
        }
        await db.insert(messages).values({ conversationId: convId, workspaceId: workspace.id, role: "assistant", content: assistantText.slice(0, 4000), analysisRequestId: request.id });
        await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convId));
      } catch (err) {
        logger.error("analyst.failed", { requestId: request.id, ...errorFields(err) });
        const message = "Something went wrong while analyzing your dataset. Your data was not modified.";
        await db.update(analysisRequests).set({ status: "failed", errorCode: "internal", errorMessage: message, durationMs: Date.now() - started })
          .where(eq(analysisRequests.id, request.id)).catch(() => {});
        send({ type: "error", message });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
