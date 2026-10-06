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

## AI (Phase 3)
- The model never runs code: it returns a plan in a strict schema; the engine executes
  only pre-written operations. Plans are validated against the dataset before running.
- Uploaded content (column names, values) is passed as labelled data and the model is told
  not to follow instructions in it; even if it did, it can only produce a valid plan or
  text whose numbers must reference engine facts.
- The model has no tools with side effects and no access to other workspaces, API keys,
  environment variables or files. Its prompt contains only the current dataset's
  description and this conversation's earlier turns.
- Conversations, analyses and usage rows all carry `workspace_id`; the chat endpoint
  resolves the conversation and dataset inside the caller's workspace (tested with forged
  ids). Viewers can read analyses but not run them.
- `OPENAI_API_KEY` stays on the server; the browser only talks to `/api/analyst/chat`.
- 30 questions per user per 10 minutes (in-process, see rate-limit note above).

## Knowledge base (Phase 6)
- Documents get the same untrusted-file treatment as datasets (signatures, size and page
  limits, macro and zip-bomb rejection); PDF scripts and forms are never executed.
- Vectors live in a Pinecone namespace per workspace, every query also filters on
  `workspace_id`, and every returned id is re-checked in PostgreSQL before its text is used.
- Instruction-like passages are flagged and never sent to a model; see `KNOWLEDGE.md` for
  the full prompt-injection defences. Pinecone and OpenAI keys stay on the server.

## Reports (Phase 7)
- Reports are scoped to the workspace like everything else; PDF and CSV routes check the
  workspace and return 404 otherwise.
- Share links: 256-bit random tokens, stored only as SHA-256, revocable, read-only pages
  marked `noindex`, rate-limited PDF downloads. A shared page shows the report snapshot and
  nothing else from the workspace.
- The PDF renderer receives finished text and figures only and escapes all text.

## Not yet in place (scheduled)
Email verification and password reset, CSRF review for API routes, Content-Security-Policy,
distributed rate limiting and monitoring (Phase 10).
