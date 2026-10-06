CREATE TYPE "public"."report_status" AS ENUM('generating', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"created_by_id" uuid,
	"title" varchar(200) NOT NULL,
	"status" "report_status" DEFAULT 'generating' NOT NULL,
	"content" jsonb,
	"error_message" varchar(500),
	"share_token_hash" char(64),
	"shared_at" timestamp (3) with time zone,
	"duration_ms" integer,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_workspace_created_idx" ON "reports" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_share_token_key" ON "reports" USING btree ("share_token_hash");