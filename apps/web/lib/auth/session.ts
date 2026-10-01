import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, eq, sessions, users } from "@insight/database";
import type { SessionUser } from "@insight/types";
import { SESSION_COOKIE, SESSION_REFRESH_MS, SESSION_TTL_MS } from "./config";
import { generateSessionToken, hashSessionToken } from "./tokens";

export interface CurrentSession {
  sessionId: string;
  user: SessionUser;
  activeWorkspaceId: string | null;
}

// __Host- cookies are only replaced or removed by a Set-Cookie with identical attributes,
// so setting and clearing must share one definition.
function cookieAttributes() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function createSession(userId: string, activeWorkspaceId: string | null = null) {
  const token = generateSessionToken();
  const h = await headers();
  await db.insert(sessions).values({
    tokenHash: hashSessionToken(token),
    userId,
    activeWorkspaceId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ipAddress: await clientIp(),
    userAgent: h.get("user-agent")?.slice(0, 512) ?? null,
  });
  (await cookies()).set(SESSION_COOKIE, token, { ...cookieAttributes(), maxAge: SESSION_TTL_MS / 1000 });
}

/** Resolves the session once per request. Returns null when signed out or expired. */
export const getSession = cache(async (): Promise<CurrentSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [session] = await db
    .select({
      id: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      activeWorkspaceId: sessions.activeWorkspaceId,
      user: { id: users.id, email: users.email, name: users.name, deletedAt: users.deletedAt },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .limit(1);
  if (!session || session.expiresAt < new Date() || session.user.deletedAt) return null;

  // Sliding expiry, written at most once per day to avoid a write on every request.
  if (Date.now() - session.lastSeenAt.getTime() > SESSION_REFRESH_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessions.id, session.id));
  }

  const { id, email, name } = session.user;
  return { sessionId: session.id, user: { id, email, name }, activeWorkspaceId: session.activeWorkspaceId };
});

export async function requireSession(): Promise<CurrentSession> {
  const session = await getSession();
  if (!session) {
    const path = (await headers()).get("x-insight-path");
    redirect(path && path.startsWith("/") && !path.startsWith("//") ? `/login?next=${encodeURIComponent(path)}` : "/login");
  }
  return session;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
  jar.set(SESSION_COOKIE, "", { ...cookieAttributes(), maxAge: 0 });
}
