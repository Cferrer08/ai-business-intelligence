"use server";

import { redirect } from "next/navigation";
import { and, asc, db, eq, isNull, isUniqueViolation, users, workspaceMembers, workspaces } from "@insight/database";
import type { ActionResult } from "@insight/types";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/lib/auth/password";
import { clientIp, createSession, destroySession, getSession } from "@/lib/auth/session";
import { loginLimiter, signupLimiter } from "@/lib/auth/rate-limit";
import { fieldErrors, loginSchema, signupSchema } from "@/lib/validation";
import { audit } from "@/lib/server/audit";
import { errorFields, logger } from "@/lib/server/logger";

export type AuthState = ActionResult | null;

// React resets forms after an action, so non-secret inputs are echoed back to re-fill them.
const text = (form: FormData, key: string) => String(form.get(key) ?? "").slice(0, 300);

export async function signup(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    password: form.get("password"),
  });
  const values = { name: text(form, "name"), email: text(form, "email") };
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error), values };

  const ip = await clientIp();
  if (!signupLimiter(`signup:${ip ?? "unknown"}`).allowed) {
    return { ok: false, error: "Too many sign-up attempts. Try again in an hour.", values };
  }

  const { name, email, password } = parsed.data;
  let userId: string;
  try {
    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash: await hashPassword(password) })
      .returning({ id: users.id });
    userId = user.id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "An account with this email already exists.", fieldErrors: { email: "Already registered. Sign in instead." }, values };
    }
    logger.error("auth.signup_failed", { ...errorFields(err) });
    return { ok: false, error: "Your account could not be created. Try again.", values };
  }

  await createSession(userId);
  await audit({ action: "auth.signup", userId, ipAddress: ip });
  redirect("/onboarding");
}

export async function login(_prev: AuthState, form: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  const values = { email: text(form, "email") };
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error), values };

  const { email, password } = parsed.data;
  const ip = await clientIp();
  const limit = loginLimiter(`login:${ip ?? "unknown"}:${email}`);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterMs / 60000);
    return { ok: false, error: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, values };
  }

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  // Always run a bcrypt compare so response time doesn't reveal whether the email exists.
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || user.deletedAt || !valid) {
    await audit({ action: "auth.login_failed", userId: user?.id ?? null, ipAddress: ip, metadata: { reason: "invalid_credentials" } });
    return { ok: false, error: "That email and password don't match an account.", values };
  }

  const [firstMembership] = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, user.id), isNull(workspaces.deletedAt)))
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  await createSession(user.id, firstMembership?.workspaceId ?? null);
  await audit({ action: "auth.login", userId: user.id, workspaceId: firstMembership?.workspaceId ?? null, ipAddress: ip });

  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logout() {
  const session = await getSession();
  await destroySession();
  if (session) await audit({ action: "auth.logout", userId: session.user.id, workspaceId: session.activeWorkspaceId });
  redirect("/login");
}
