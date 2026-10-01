import "server-only";

type Level = "info" | "warn" | "error";

/** Structured JSON logs. Fields grow in later phases (requestId, datasetId, tokens, cost). */
function write(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Error details for logs. Database errors are wrapped ("Failed query: …"); the real reason
 * (missing table, refused connection, constraint) is on `cause`, so include it.
 */
export function errorFields(err: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { err: err instanceof Error ? err.message : String(err) };
  const cause = (err as { cause?: unknown })?.cause;
  if (cause) {
    out.cause = cause instanceof Error ? cause.message : String(cause);
    const code = (cause as { code?: unknown }).code;
    if (code) out.code = code;
  }
  return out;
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
