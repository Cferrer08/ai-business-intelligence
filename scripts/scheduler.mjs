// Calls the app's scheduler endpoint every minute. Use this when you don't run the Docker
// "scheduler" service:   node scripts/scheduler.mjs
// Reads CRON_SECRET and APP_URL (default http://localhost:3000) from the environment or
// apps/web/.env.local.
import { readFileSync, existsSync } from "node:fs";

const envFile = new URL("../apps/web/.env.local", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const secret = process.env.CRON_SECRET;
const url = `${(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/cron/tick`;
if (!secret) { console.error("Set CRON_SECRET in apps/web/.env.local"); process.exit(1); }

async function tick() {
  try {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    const body = await res.json().catch(() => ({}));
    const ran = body.ran?.length ?? 0;
    console.log(`${new Date().toISOString()} ${res.status}${ran ? ` ran ${ran} workflow(s)` : ""}`);
  } catch (err) {
    console.log(`${new Date().toISOString()} app not reachable (${err.message})`);
  }
}
console.log(`Scheduler calling ${url} every minute. Ctrl+C to stop.`);
tick();
setInterval(tick, 60_000);
