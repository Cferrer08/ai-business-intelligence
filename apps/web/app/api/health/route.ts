import { NextResponse } from "next/server";
import { db, getSchemaStatus, sql } from "@insight/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    const schema = await getSchemaStatus();
    return NextResponse.json(
      { status: schema.ok ? "ok" : "degraded", database: "ok", migrations: schema.ok ? "current" : `pending (${schema.applied}/${schema.expected} applied, run npm run db:migrate)`, latencyMs: Date.now() - started },
      { status: schema.ok ? 200 : 503 },
    );
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
