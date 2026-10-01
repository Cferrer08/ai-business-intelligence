import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";

// Same .env loading as src/migrate.ts, for `npm run db:generate`.
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
