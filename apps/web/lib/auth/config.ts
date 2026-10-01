export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-insight_session" : "insight_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
export const SESSION_REFRESH_MS = 1000 * 60 * 60 * 24; // extend at most once a day
