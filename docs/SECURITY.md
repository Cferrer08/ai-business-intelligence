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

## Uploaded files (Phase 2)
- Browser and server check extension and size; the engine re-checks everything.
- Upload streamed to disk and stopped as soon as it passes the size limit.
- Content signatures: XLSX must be a real workbook archive, Parquet must have PAR1 markers,
  CSV/JSON must not contain binary data.
- XLSX: macro-enabled workbooks rejected; zip bombs rejected by total size and compression
  ratio; formulas never evaluated.
- Row, column and concurrency limits protect the engine's memory.
- Storage paths are built from UUIDs only; the uploaded filename never touches the disk.
- Engine requires a shared key (constant-time comparison) and refuses to start without one.
  In Docker it runs as an unprivileged user with a read-only filesystem, no Linux
  capabilities, and 2 GB memory / 2 CPU limits, published only on 127.0.0.1.
- Datasets, columns and profiles all carry `workspace_id`; every query filters on the
  active workspace. Engine files are partitioned by workspace, so a request for another
  workspace's dataset id finds nothing (both covered by tests).
- Errors shown to users come from a fixed set of safe messages; internals are logged.

## Not yet in place (scheduled)
Email verification and password reset, CSRF review for API routes once they accept
mutations (server actions already enforce same-origin), Content-Security-Policy, AI prompt-injection defenses (Phase 3), distributed rate
limiting and monitoring (Phase 10).
