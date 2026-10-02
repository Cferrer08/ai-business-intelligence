# Architecture (Phase 1)

```
insight-ai/
├── apps/web/                 Next.js app (UI, server actions, API routes, middleware)
│   ├── app/(auth)/           /login, /signup
│   ├── app/(app)/            Signed-in shell: /dashboard, /settings, upcoming sections
│   ├── app/onboarding/       First-workspace creation
│   ├── app/actions/          Server actions (auth, workspace)
│   ├── app/api/health/       Health check (DB round trip)
│   ├── components/           UI, auth forms, app shell, marketing
│   ├── lib/auth/             Passwords, session tokens, sessions, rate limiting
│   ├── lib/server/           Tenancy guard, audit log, logger (server-only)
│   └── e2e/                  Playwright end-to-end suite
├── services/data-engine/     Python FastAPI service: file validation, typing, profiling
├── packages/ai/              AI analyst: plan schema, prompts, validation, grounding, eval
├── packages/database/        Drizzle schema, client, SQL migrations, migrator
├── packages/types/           Types shared with future AI and data-engine layers
├── infrastructure/           docker-compose for local Postgres
└── docs/
```

The spec's top-level `ai/` folder lives at `packages/ai` so it is an npm workspace package
like the others. See `DATA_ENGINE.md` and `AI_ARCHITECTURE.md`.

## Request flow

1. **Middleware** checks only whether a session cookie exists for protected paths and
   redirects to `/login?next=…` if not. It is a convenience, not a security boundary.
2. **`requireSession()`** looks up the SHA-256 of the cookie token in `sessions`, checks
   expiry and that the user isn't deleted, and slides the expiry at most once a day.
3. **`requireWorkspace(minRole)`** loads the user's memberships and resolves the active
   workspace from the session. Every tenant-scoped page and action starts here.
4. Server actions validate input with Zod and return `ActionResult` objects; the UI never
   receives raw errors.

## Data model

| Table | Purpose |
| --- | --- |
| `users` | Account. Email is unique and must be lowercase (CHECK constraint). Soft-deletable. |
| `sessions` | Hashed session token, active workspace, expiry, IP and user agent. |
| `workspaces` | Tenant. Unique slug with random suffix. Soft-deletable. |
| `workspace_members` | User ↔ workspace with role. Unique per pair. |
| `audit_logs` | Security-relevant events, indexed by workspace and user over time. |

| `datasets` | Upload metadata, status (processing/ready/failed), counts, quality score. Soft-deletable. |
| `dataset_columns` | One row per column: type, role, concept, missing/unique counts, stats. |
| `dataset_profiles` | Full engine profile (JSON), read notes, engine version. |

| `conversations` | One per analysis thread, tied to a dataset. |
| `messages` | User questions and assistant replies, linked to their analysis request. |
| `analysis_requests` | Question, validated plan, status, error, duration. |
| `analysis_results` | Engine result (tables + facts) and the explanation (with placeholders). |
| `ai_requests` | Every model call: purpose, model, tokens, estimated cost, duration, outcome. |

| `charts` | Charts pinned to the dashboard: which analysis result, chart type, top-N. |

Later phases add tables (reports, forecasts, anomalies, documents, workflows, billing). Each carries
`workspace_id`, and every query takes that id from `requireWorkspace()`, never from input.

## Why Drizzle

Plain SQL migrations that are easy to review, no native engine binary, and a small runtime
that suits serverless deployment. The client connects lazily so builds never open a
database connection.
