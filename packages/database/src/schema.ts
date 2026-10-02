// Phase 1 schema: identity, sessions, workspaces (tenancy), audit log.
// Dataset / analysis / billing tables arrive as separate migrations in later phases,
// each carrying workspace_id so tenant isolation is enforced at the data layer.
import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, index, integer, jsonb, numeric, pgEnum, pgTable, smallint, timestamp, uniqueIndex, uuid, varchar, text } from "drizzle-orm/pg-core";

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

// ---------------------------------------------------------------------------
// Phase 3: AI analyst. A conversation is tied to one dataset. Each question creates an
// analysis request (the validated plan) and, on success, a result (engine output plus the
// explanation). Every model call is recorded in ai_requests for usage and cost tracking.
// ---------------------------------------------------------------------------

export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const analysisStatus = pgEnum("analysis_status", ["running", "succeeded", "failed", "clarification", "unsupported"]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  datasetId: uuid("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  title: varchar("title", { length: 160 }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: ts("deleted_at"),
}, (t) => [index("conversations_workspace_updated_idx").on(t.workspaceId, t.updatedAt)]);

export const analysisRequests = pgTable("analysis_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  datasetId: uuid("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  question: varchar("question", { length: 1000 }).notNull(),
  plan: jsonb("plan"),
  status: analysisStatus("status").notNull().default("running"),
  errorCode: varchar("error_code", { length: 60 }),
  errorMessage: varchar("error_message", { length: 500 }),
  durationMs: integer("duration_ms"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("analysis_requests_workspace_created_idx").on(t.workspaceId, t.createdAt),
  index("analysis_requests_conversation_idx").on(t.conversationId, t.createdAt),
]);

export const analysisResults = pgTable("analysis_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => analysisRequests.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  result: jsonb("result").notNull(),
  insight: jsonb("insight").notNull(),
  // "model" when the explanation passed validation, "template" when the fallback was used.
  insightSource: varchar("insight_source", { length: 20 }).notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("analysis_results_request_key").on(t.requestId)]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  role: messageRole("role").notNull(),
  content: text("content").notNull(),
  analysisRequestId: uuid("analysis_request_id").references(() => analysisRequests.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt)]);

export const aiRequests = pgTable("ai_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  analysisRequestId: uuid("analysis_request_id").references(() => analysisRequests.id, { onDelete: "set null" }),
  purpose: varchar("purpose", { length: 30 }).notNull(), // plan | plan_repair | interpret | interpret_retry
  model: varchar("model", { length: 80 }).notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  durationMs: integer("duration_ms").notNull(),
  succeeded: boolean("succeeded").notNull(),
  errorCode: varchar("error_code", { length: 60 }),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("ai_requests_workspace_created_idx").on(t.workspaceId, t.createdAt),
  index("ai_requests_user_created_idx").on(t.userId, t.createdAt),
]);

// ---------------------------------------------------------------------------
// Phase 4: charts pinned to the dashboard. A pin points at a stored analysis result, so
// the chart is redrawn from the engine's saved numbers; it is a snapshot of that analysis.
// ---------------------------------------------------------------------------

export const charts = pgTable("charts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  analysisResultId: uuid("analysis_result_id").notNull().references(() => analysisResults.id, { onDelete: "cascade" }),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  title: varchar("title", { length: 160 }).notNull(),
  chartType: varchar("chart_type", { length: 20 }).notNull(),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("charts_workspace_result_key").on(t.workspaceId, t.analysisResultId),
  index("charts_workspace_created_idx").on(t.workspaceId, t.createdAt),
]);

export type Dataset = typeof datasets.$inferSelect;
export type DatasetColumn = typeof datasetColumns.$inferSelect;

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
