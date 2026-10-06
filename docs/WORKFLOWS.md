# Workflows and notifications (Phase 8)

## Types

| Type | What it does |
| --- | --- |
| Business briefing (daily / weekly / monthly) | Latest complete day, week or month in the data vs the one before (days: the same weekday a week earlier), revenue, orders, customers, average order value, biggest movers (groups that changed 10%+ and matter), unusual days in the period, and a summary. |
| Weekly business review | The weekly briefing plus a full business report (Phase 7), every week. |
| Scheduled report | A full business report on a schedule. |
| Alert | Revenue, orders or average order value falls or rises by at least N% vs the previous period; something unusual in the latest period; or rows meeting a condition (a numeric column below/above a value or another column, e.g. on-hand stock below its reorder point). |

Uploaded files aren't a live feed, so a briefing describes the latest period **in the data**,
says which period that is, and warns when the data is out of date.

## Scheduling

- Schedules are stored as local wall-clock time plus an IANA time zone and converted with the
  platform's time-zone data, so "Monday 8:00 AM" stays 8:00 AM across daylight-saving changes.
  A time skipped by the spring change runs just after the jump; a repeated autumn hour runs once.
- `POST /api/cron/tick` (with `Authorization: Bearer $CRON_SECRET`, compared in constant time)
  claims due workflows with `SELECT … FOR UPDATE SKIP LOCKED`, moves each to its next run, and
  executes it. Each run is unique per (workflow, scheduled time), so concurrent ticks can't run
  an occurrence twice. Runs missed while the app was off run once, then continue from now.
- Locally, the `scheduler` service in `docker-compose.yml` calls the tick every minute
  (`host.docker.internal:3000`). Without Docker: `npm run scheduler`. In production, any cron
  (Vercel Cron, a server cron job) can call the endpoint.

## Notifications and failures

- Results notify every member of the workspace in the app (the Notifications link shows the
  unread count). Briefings and reports always notify; alerts only when triggered, and not
  again while the result is unchanged (same period or same matching rows).
- A failed run notifies members with the reason. After five failures in a row the workflow is
  paused and members are told; Resume clears the count.
- "Run now" works without the scheduler.

## Setup

`CRON_SECRET` in `apps/web/.env.local` must match the scheduler's (the defaults in
`.env.example` and `docker-compose.yml` match). `docker compose up -d --build` starts the
scheduler with the other services; keep `npm run dev` running on port 3000.
