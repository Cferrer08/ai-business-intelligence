import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type DB = NodePgDatabase<typeof schema>;

// One pool per process, reused across hot reloads in development.
const g = globalThis as unknown as { __insightPool?: Pool; __insightDb?: DB };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
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
