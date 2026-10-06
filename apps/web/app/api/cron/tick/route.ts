import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { tick } from "@/lib/server/workflows";
import { getSchemaStatus } from "@insight/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called every minute by the scheduler container (or any cron service) with the shared secret. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return NextResponse.json({ ok: false, error: "CRON_SECRET isn't configured." }, { status: 503 });
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await getSchemaStatus()).ok) return NextResponse.json({ ok: false, error: "Database needs migrating." }, { status: 503 });
  const ran = await tick();
  return NextResponse.json({ ok: true, ran });
}
