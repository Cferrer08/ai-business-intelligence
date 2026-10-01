// Phase 1 schema: identity, sessions, workspaces (tenancy), audit log.
// Dataset / analysis / billing tables arrive as separate migrations in later phases,
// each carrying workspace_id so tenant isolation is enforced at the data layer.
import { sql } from "drizzle-orm";
import { char, check, index, jsonb, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar, text } from "drizzle-orm/pg-core";

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

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
