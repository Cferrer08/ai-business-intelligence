import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

type DB = NodePgDatabase<typeof schema>;

// One pool per process, reused across hot reloads in development.
const g = globalThis as unknown as { __insightPool?: Pool; __insightDb?: DB };

/**
 * On Windows "localhost" often resolves to IPv6 (::1) first, while the dev Postgres
 * container listens on 127.0.0.1 only. Use the IPv4 loopback explicitly.
 */
export function normalizeDatabaseUrl(url: string): string {
  return url.replace(/@localhost(?=[:/])/i, "@127.0.0.1");
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return normalizeDatabaseUrl(url);
}

export function getDb(): DB {
  if (!g.__insightDb) {
    g.__insightPool ??= new Pool({
      connectionString: connectionString(),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
    });
    g.__insightDb = drizzle(g.__insightPool, { schema });
  }
  return g.__insightDb;
}

/** Lazily-connected client, so importing this module never opens a connection at build time. */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as Function).bind(real) : value;
  },
});

export * from "./schema";
export { and, asc, desc, eq, gt, inArray, isNull, sql, count } from "drizzle-orm";

/** Postgres unique-violation check that works across drivers / wrapped errors. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Schema status: is the database migrated to match this code?
// ---------------------------------------------------------------------------
import journal from "../migrations/meta/_journal.json";

export interface SchemaStatus {
  ok: boolean;
  applied: number;
  expected: number;
}

let schemaOk = false;

/** Compares applied migrations with the ones shipped in the code. Cached once current. */
export async function getSchemaStatus(): Promise<SchemaStatus> {
  const expected = (journal as { entries: unknown[] }).entries.length;
  if (schemaOk) return { ok: true, applied: expected, expected };
  let applied = 0;
  try {
    const res = await getDb().execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    applied = Number((res.rows[0] as { n: number }).n);
  } catch (err) {
    const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
    // 3F000: schema "drizzle" missing, 42P01: table missing -> nothing applied yet
    if (code !== "3F000" && code !== "42P01") throw err;
  }
  schemaOk = applied >= expected;
  return { ok: schemaOk, applied, expected };
}
