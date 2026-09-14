CREATE TYPE "public"."mock_auth_mode" AS ENUM('private', 'public-link', 'simulated-auth');--> statement-breakpoint
CREATE TYPE "public"."mock_cache" AS ENUM('hit', 'miss', 'bypass');--> statement-breakpoint
CREATE TYPE "public"."mock_locale" AS ENUM('en', 'id_ID');--> statement-breakpoint
CREATE TYPE "public"."mock_validation" AS ENUM('passed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."rule_id" AS ENUM('RS001', 'RS002', 'RS003', 'RS004', 'RS005', 'RS006', 'RS007', 'RS008', 'RS009', 'RS010');--> statement-breakpoint
CREATE TYPE "public"."standard_preset" AS ENUM('simple', 'jsonapi', 'problem-details', 'google', 'none');--> statement-breakpoint
CREATE TYPE "public"."standard_state" AS ENUM('draft', 'active');--> statement-breakpoint
CREATE TABLE "mock_configs" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"auth_mode" "mock_auth_mode" DEFAULT 'private' NOT NULL,
	"validate_requests" boolean DEFAULT true NOT NULL,
	"locale" "mock_locale" DEFAULT 'en' NOT NULL,
	"token_hash" text,
	"token_hint" varchar(16),
	"token_rotated_at" timestamp with time zone,
	"public_slug" varchar(64),
	"entity_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_daily_stats" (
	"project_id" uuid NOT NULL,
	"day" timestamp with time zone NOT NULL,
	"endpoint_id" uuid,
	"request_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"validation_failure_count" integer DEFAULT 0 NOT NULL,
	"total_latency_ms" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNLOGGED TABLE "mock_request_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_key" varchar(64) NOT NULL,
	"method" varchar(10) NOT NULL,
	"path" text NOT NULL,
	"endpoint_id" uuid,
	"status_code" integer NOT NULL,
	"source" varchar(40) NOT NULL,
	"latency_ms" integer NOT NULL,
	"validation" "mock_validation" DEFAULT 'skipped' NOT NULL,
	"cache" "mock_cache" DEFAULT 'miss' NOT NULL,
	"request_id" varchar(64) NOT NULL,
	"caller_ip" varchar(64),
	"request_body" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_scenarios" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"entity_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lint_exemptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"rule_id" "rule_id" NOT NULL,
	"justification" text NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lint_results" (
	"endpoint_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"standard_version" integer NOT NULL,
	"violations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"warn_count" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response_standards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"state" "standard_state" DEFAULT 'draft' NOT NULL,
	"preset" "standard_preset" DEFAULT 'simple' NOT NULL,
	"definition" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"entity_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mock_configs" ADD CONSTRAINT "mock_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_daily_stats" ADD CONSTRAINT "mock_daily_stats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_scenarios" ADD CONSTRAINT "mock_scenarios_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lint_exemptions" ADD CONSTRAINT "lint_exemptions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lint_exemptions" ADD CONSTRAINT "lint_exemptions_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lint_exemptions" ADD CONSTRAINT "lint_exemptions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lint_results" ADD CONSTRAINT "lint_results_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lint_results" ADD CONSTRAINT "lint_results_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_standards" ADD CONSTRAINT "response_standards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_standards" ADD CONSTRAINT "response_standards_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mock_daily_stats_key_idx" ON "mock_daily_stats" USING btree ("project_id","day","endpoint_id");--> statement-breakpoint
CREATE INDEX "mock_request_logs_project_time_idx" ON "mock_request_logs" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "mock_request_logs_endpoint_idx" ON "mock_request_logs" USING btree ("endpoint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_scenarios_project_name_idx" ON "mock_scenarios" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "lint_exemptions_endpoint_rule_idx" ON "lint_exemptions" USING btree ("endpoint_id","rule_id");--> statement-breakpoint
CREATE INDEX "lint_exemptions_project_idx" ON "lint_exemptions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "lint_results_project_version_idx" ON "lint_results" USING btree ("project_id","standard_version");--> statement-breakpoint
CREATE INDEX "lint_results_errors_idx" ON "lint_results" USING btree ("project_id","error_count");--> statement-breakpoint
CREATE UNIQUE INDEX "response_standards_project_state_idx" ON "response_standards" USING btree ("project_id","state");