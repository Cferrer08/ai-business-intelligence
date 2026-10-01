# Security (Phase 1 scope)

## Authentication
- Passwords: bcrypt, cost 12. Length 10–64 (stays under bcrypt's 72-byte limit).
- Sign-in runs a bcrypt comparison even for unknown emails, so timing doesn't reveal
  which emails have accounts. The error message is the same in both cases.
- Sessions: 256-bit random token in an httpOnly, SameSite=Lax cookie (`__Host-` prefixed
  and Secure in production). Only the SHA-256 hash is stored. 14-day sliding expiry.
- Sign-out deletes the session row and clears the cookie with matching attributes.
  A cookie whose session was revoked server-side is treated as signed out, without loops.
- `next` redirect targets must be same-site paths (`/x`, not `//x` or absolute URLs).

## Authorization and tenant isolation
- All workspace access goes through `requireWorkspace()` / `assertMembership()`.
- Workspace ids submitted by forms are re-checked against `workspace_members`. A forged id
  is ignored (covered by the E2E suite).
- Renaming requires admin or owner.

## Abuse protection
- Rate limits: 8 sign-in attempts per IP+email per 15 min; 5 sign-ups per IP per hour.
  **Known limitation:** counters are in-process, so on multi-instance or serverless
  hosting each instance counts separately. Phase 10 moves them to Redis.
- Each user can own at most 10 workspaces until plan limits arrive in Phase 9.

## Headers
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict referrer policy,
restrictive permissions policy, no `X-Powered-By`.

## Audit log
Sign-up, sign-in, failed sign-in, sign-out, workspace create/switch/rename. Audit failures
are logged and never block the user's request.

## Not yet in place (scheduled)
Email verification and password reset, CSRF review for API routes once they accept
mutations (server actions already enforce same-origin), Content-Security-Policy, file
upload validation (Phase 2), AI prompt-injection defenses (Phase 3), distributed rate
limiting and monitoring (Phase 10).
