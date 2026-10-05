import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiWorkspace } from "@/lib/server/workspace";
import { knowledgeConfigured, searchKnowledge, VectorStoreError } from "@/lib/server/knowledge";
import { createRateLimiter } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 60, windowMs: 5 * 60 * 1000 });

export async function GET(req: Request) {
  const auth = await getApiWorkspace("VIEWER");
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
  if (!knowledgeConfigured().ok) return NextResponse.json({ ok: false, error: "The knowledge base isn't configured." }, { status: 503 });
  const q = z.string().trim().min(2).max(300).safeParse(new URL(req.url).searchParams.get("q"));
  if (!q.success) return NextResponse.json({ ok: false, error: "Type at least two characters." }, { status: 400 });
  if (!limiter(`search:${auth.ctx.session.user.id}`).allowed) return NextResponse.json({ ok: false, error: "Too many searches. Wait a moment." }, { status: 429 });
  try {
    const results = await searchKnowledge(auth.ctx.workspace.id, auth.ctx.session.user.id, q.data, { includeFlagged: true, topK: 8 });
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    const message = err instanceof VectorStoreError ? err.message : "Search isn't available right now.";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
