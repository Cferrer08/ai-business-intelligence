CREATE TYPE "public"."dataset_format" AS ENUM('csv', 'xlsx', 'json', 'parquet');--> statement-breakpoint
CREATE TYPE "public"."dataset_status" AS ENUM('processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "dataset_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"name" varchar(120) NOT NULL,
	"logical_type" varchar(20) NOT NULL,
	"semantic_role" varchar(20) NOT NULL,
	"concept" varchar(30),
	"role_confidence" varchar(10) NOT NULL,
	"missing_count" integer NOT NULL,
	"unique_count" integer NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"is_integer" boolean DEFAULT false NOT NULL,
	"converted_from" varchar(120),
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"profile" jsonb NOT NULL,
	"read_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"engine_version" varchar(20) NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"file_format" "dataset_format" NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" "dataset_status" DEFAULT 'processing' NOT NULL,
	"row_count" integer,
	"column_count" integer,
	"quality_score" smallint,
	"error_message" varchar(500),
	"created_by_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "datasets_quality_range" CHECK ("datasets"."quality_score" is null or ("datasets"."quality_score" between 0 and 100)),
	CONSTRAINT "datasets_size_positive" CHECK ("datasets"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "dataset_columns" ADD CONSTRAINT "dataset_columns_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_columns" ADD CONSTRAINT "dataset_columns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_profiles" ADD CONSTRAINT "dataset_profiles_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_profiles" ADD CONSTRAINT "dataset_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_columns_dataset_position_key" ON "dataset_columns" USING btree ("dataset_id","position");--> statement-breakpoint
CREATE INDEX "dataset_columns_workspace_role_idx" ON "dataset_columns" USING btree ("workspace_id","semantic_role");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_profiles_dataset_key" ON "dataset_profiles" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "datasets_workspace_created_idx" ON "datasets" USING btree ("workspace_id","created_at");