// View model for one question/answer turn, shared by the server page and the stream.
import type { AnalysisSpec, EngineResult, Insight, RenderedInsight } from "@insight/ai";

export type TurnStatus = "running" | "succeeded" | "failed" | "clarification" | "unsupported";

export interface TurnView {
  requestId: string;
  question: string;
  status: TurnStatus;
  title: string | null;
  message: string | null;
  plan: AnalysisSpec | null;
  result: EngineResult | null;
  insight: Insight | null;
  rendered: RenderedInsight | null;
  insightSource: "model" | "template" | null;
  resultId: string | null;
  pinned: boolean;
  createdAt: string;
}

export type StreamEvent =
  | { type: "started"; conversationId: string; requestId: string }
  | { type: "status"; step: "planning" | "validating" | "computing" | "explaining" }
  | { type: "plan"; title: string; analysis: AnalysisSpec }
  | { type: "done"; turn: TurnView }
  | { type: "error"; message: string };
