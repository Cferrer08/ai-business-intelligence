// Phase 1 schema: identity, sessions, workspaces (tenancy), audit log.
// Dataset / analysis / billing tables arrive as separate migrations in later phases,
// each carrying workspace_id so tenant isolation is enforced at the data layer.
import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, index, integer, jsonb, pgEnum, pgTable, smallint, timestamp, uniqueIndex, uuid, varchar, text } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

export const workspaceRole = pgEnum("workspace_role", ["OWNER", "ADMIN", "MEMBER", "VIEWER"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Always stored lowercased and trimmed (normalized in the app layer); the check enforces it.
  email: varchar("email", { length: 254 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: ts("deleted_at"),
}, (t) => [
  uniqueIndex("users_email_key").on(t.email),
  check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 80 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull(),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: ts("deleted_at"),
}, (t) => [uniqueIndex("workspaces_slug_key").on(t.slug), index("workspaces_created_by_idx").on(t.createdById)]);

export const workspaceMembers = pgTable("workspace_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: workspaceRole("role").notNull().default("MEMBER"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("workspace_members_workspace_user_key").on(t.workspaceId, t.userId),
  index("workspace_members_user_idx").on(t.userId),
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // SHA-256 of the cookie token. The raw token never touches the database.
  tokenHash: char("token_hash", { length: 64 }).notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activeWorkspaceId: uuid("active_workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: varchar("user_agent", { length: 512 }),
}, (t) => [
  uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
  index("sessions_user_idx").on(t.userId),
  index("sessions_expires_idx").on(t.expiresAt),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 64 }).notNull(),
  targetType: varchar("target_type", { length: 64 }),
  targetId: varchar("target_id", { length: 64 }),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("audit_logs_workspace_created_idx").on(t.workspaceId, t.createdAt),
  index("audit_logs_user_created_idx").on(t.userId, t.createdAt),
]);

// ---------------------------------------------------------------------------
// Phase 2: datasets. Files live in the data engine; Postgres holds metadata + profile.
// Every table carries workspace_id so queries can always be scoped to one tenant.
// ---------------------------------------------------------------------------

export const datasetStatus = pgEnum("dataset_status", ["processing", "ready", "failed"]);
export const datasetFormat = pgEnum("dataset_format", ["csv", "xlsx", "json", "parquet"]);

export const datasets = pgTable("datasets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  fileFormat: datasetFormat("file_format").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  status: datasetStatus("status").notNull().default("processing"),
  rowCount: integer("row_count"),
  columnCount: integer("column_count"),
  qualityScore: smallint("quality_score"),
  // User-facing failure reason (from the engine's safe messages). Never a stack trace.
  errorMessage: varchar("error_message", { length: 500 }),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: ts("deleted_at"),
}, (t) => [
  index("datasets_workspace_created_idx").on(t.workspaceId, t.createdAt),
  check("datasets_quality_range", sql`${t.qualityScore} is null or (${t.qualityScore} between 0 and 100)`),
  check("datasets_size_positive", sql`${t.sizeBytes} >= 0`),
]);

export const datasetColumns = pgTable("dataset_columns", {
  id: uuid("id").primaryKey().defaultRandom(),
  datasetId: uuid("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  position: smallint("position").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  logicalType: varchar("logical_type", { length: 20 }).notNull(),
  semanticRole: varchar("semantic_role", { length: 20 }).notNull(),
  concept: varchar("concept", { length: 30 }),
  roleConfidence: varchar("role_confidence", { length: 10 }).notNull(),
  missingCount: integer("missing_count").notNull(),
  uniqueCount: integer("unique_count").notNull(),
  invalidCount: integer("invalid_count").notNull().default(0),
  isInteger: boolean("is_integer").notNull().default(false),
  convertedFrom: varchar("converted_from", { length: 120 }),
  stats: jsonb("stats").notNull().default(sql`'{}'::jsonb`),
}, (t) => [
  uniqueIndex("dataset_columns_dataset_position_key").on(t.datasetId, t.position),
  index("dataset_columns_workspace_role_idx").on(t.workspaceId, t.semanticRole),
]);

export const datasetProfiles = pgTable("dataset_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  datasetId: uuid("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  profile: jsonb("profile").notNull(),
  readNotes: jsonb("read_notes").notNull().default(sql`'[]'::jsonb`),
  engineVersion: varchar("engine_version", { length: 20 }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("dataset_profiles_dataset_key").on(t.datasetId)]);

export type Dataset = typeof datasets.$inferSelect;
export type DatasetColumn = typeof datasetColumns.$inferSelect;

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
