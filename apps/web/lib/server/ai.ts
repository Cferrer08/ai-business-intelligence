import "server-only";
import { aiRequests, db } from "@insight/database";
import { createOpenAiClient, estimateCost, type LlmClient, type LlmUsage } from "@insight/ai";
import { logger } from "./logger";

export const DEFAULT_MODEL = "gpt-4.1-mini";

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getLlm(): LlmClient | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return createOpenAiClient({
    apiKey,
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL || undefined,
  });
}

// Per-million-token prices used for the cost estimate. Defaults match gpt-4.1-mini list
// prices at the time of writing; set them for the model you use.
const PRICES = {
  input: Number(process.env.OPENAI_PRICE_INPUT_PER_1M ?? 0.4),
  output: Number(process.env.OPENAI_PRICE_OUTPUT_PER_1M ?? 1.6),
};

export async function recordAiUsage(entry: {
  workspaceId: string;
  userId: string;
  analysisRequestId: string | null;
  purpose: string;
  model: string;
  usage: LlmUsage | undefined;
  succeeded: boolean;
  errorCode?: string;
}) {
  const u = entry.usage;
  try {
    await db.insert(aiRequests).values({
      workspaceId: entry.workspaceId,
      userId: entry.userId,
      analysisRequestId: entry.analysisRequestId,
      purpose: entry.purpose,
      model: u?.model ?? entry.model,
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
      totalTokens: (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0),
      estimatedCostUsd: (u ? estimateCost(u, PRICES) : 0).toFixed(6),
      durationMs: u?.durationMs ?? 0,
      succeeded: entry.succeeded,
      errorCode: entry.errorCode ?? null,
    });
  } catch (err) {
    logger.error("ai.usage_write_failed", { err: String(err) });
  }
  logger.info("ai.request", {
    workspaceId: entry.workspaceId, analysisRequestId: entry.analysisRequestId, purpose: entry.purpose,
    model: u?.model ?? entry.model, inputTokens: u?.inputTokens ?? 0, outputTokens: u?.outputTokens ?? 0,
    ms: u?.durationMs ?? 0, ok: entry.succeeded, errorCode: entry.errorCode,
  });
}
