import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { existsSync } from "node:fs";
import path from "node:path";

// Load packages/database/.env when present, so commands work the same in PowerShell, cmd and bash
// without inline environment-variable syntax. Variables already set in the shell win.
const envFile = path.join(__dirname, "..", ".env");
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Same Windows-friendly rewrite as the app's client (localhost -> 127.0.0.1).
  const pool = new Pool({ connectionString: url.replace(/@localhost(?=[:/])/i, "@127.0.0.1"), max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: path.join(__dirname, "..", "migrations") });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
