import { NextResponse } from "next/server";
import { db, sql } from "@insight/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", database: "ok", latencyMs: Date.now() - started });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
