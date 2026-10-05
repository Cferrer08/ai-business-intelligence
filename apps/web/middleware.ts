import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/config";

// Cheap cookie-presence gate for protected pages only. Signed-in users are sent away from
// /login and /signup by those pages after a real session check, never here: a stale cookie
// must not be able to bounce between the two.
// The real session check (DB lookup, expiry) happens in
// requireSession() on every protected page and action, so this is not the security boundary.
const PROTECTED = ["/dashboard", "/onboarding", "/settings", "/data", "/analyst", "/reports", "/forecasts", "/anomalies", "/workflows", "/analytics", "/usage", "/billing", "/knowledge"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasCookie = req.cookies.has(SESSION_COOKIE);

  if (!hasCookie && PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  // Expose the requested path to server components so a revoked session can return here after sign-in.
  const headers = new Headers(req.headers);
  headers.set("x-insight-path", pathname + search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
